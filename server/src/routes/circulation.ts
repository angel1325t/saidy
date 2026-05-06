import { Router } from 'express';
import { z } from 'zod';
import { logAuditEvent } from '../lib/audit.js';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { sendError } from '../lib/http.js';
import { hasAnyPermission, requireAnyPermission } from '../lib/rbac.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const circulationRouter = Router();

const reservationSchema = z.object({
  material_id: z.string().uuid()
});

const loanSchema = z.object({
  material_id: z.string().uuid(),
  copy_id: z.string().uuid().optional().nullable(),
  loan_type: z.enum(['physical', 'digital']).default('physical')
});

function getLoanDays(memberType: string) {
  switch (memberType) {
    case 'teacher':
      return 21;
    case 'researcher':
      return 28;
    case 'staff':
      return 21;
    default:
      return 14;
  }
}

function getFineRatePerDay(loanType: string) {
  return loanType === 'digital' ? 1.5 : 2.5;
}

function isBlocked(blockedUntil: string | null | undefined) {
  if (!blockedUntil) return false;
  return new Date(blockedUntil).getTime() > Date.now();
}

circulationRouter.get('/loans', requireAuth, requireAnyPermission('circulation:read:own', 'circulation:read:any'), async (req: AuthedRequest, res) => {
  const canReadAll = hasAnyPermission(req.auth?.permissions ?? [], 'circulation:read:any');
  let query = supabaseAdmin
    .from('loans')
    .select('*, materials(id,title,kind,cover_url), material_copies(id,barcode,copy_code,status,location)')
    .order('borrowed_at', { ascending: false });

  if (!canReadAll) {
    query = query.eq('user_id', req.auth!.userId);
  }

  const { data, error } = await query;
  if (error) {
    return sendError(res, 500, 'Unable to load loans', error.message);
  }

  return res.json({ items: data ?? [] });
});

circulationRouter.post('/loans', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = loanSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid loan payload', parsed.error.flatten());
  }

  const profile = req.auth?.profile;
  if (!profile) {
    return sendError(res, 404, 'Profile not found');
  }

  const requiredPermission =
    parsed.data.loan_type === 'digital' ? 'loans:create:digital' : 'loans:create:physical';
  if (!hasAnyPermission(req.auth?.permissions ?? [], requiredPermission)) {
    return sendError(res, 403, 'Insufficient permissions');
  }

  if (isBlocked(profile.blocked_until)) {
    return sendError(res, 403, 'Account is temporarily blocked');
  }

  const { count: activeLoans, error: activeLoansError } = await supabaseAdmin
    .from('loans')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.auth!.userId)
    .in('status', ['active', 'overdue']);

  if (activeLoansError) {
    return sendError(res, 500, 'Unable to validate loan limit', activeLoansError.message);
  }

  if ((activeLoans ?? 0) >= profile.loan_limit) {
    return sendError(res, 409, 'Loan limit reached');
  }

  if (parsed.data.loan_type === 'physical') {
    if (!parsed.data.copy_id) {
      return sendError(res, 400, 'copy_id is required for physical loans');
    }

    const { data: copy, error: copyError } = await supabaseAdmin
      .from('material_copies')
      .select('id,status,material_id')
      .eq('id', parsed.data.copy_id)
      .maybeSingle();

    if (copyError) {
      return sendError(res, 500, 'Unable to validate copy', copyError.message);
    }

    if (!copy) {
      return sendError(res, 404, 'Copy not found');
    }

    if (copy.status !== 'available') {
      return sendError(res, 409, 'Copy is not available');
    }

    const dueAt = new Date(Date.now() + getLoanDays(profile.member_type) * 24 * 60 * 60 * 1000).toISOString();
    const { data: loan, error: loanError } = await supabaseAdmin
      .from('loans')
      .insert({
        material_id: parsed.data.material_id,
        copy_id: copy.id,
        user_id: req.auth!.userId,
        processed_by: req.auth!.userId,
        loan_type: 'physical',
        status: 'active',
        due_at: dueAt
      })
      .select('*')
      .single();

    if (loanError) {
      return sendError(res, 500, 'Unable to create loan', loanError.message);
    }

    await supabaseAdmin
      .from('material_copies')
      .update({ status: 'borrowed', updated_at: new Date().toISOString() })
      .eq('id', copy.id);

    await logAuditEvent({
      actorId: req.auth!.userId,
      action: 'circulation.loan.create',
      entityType: 'loan',
      entityId: loan.id,
      metadata: { loan_type: 'physical', material_id: parsed.data.material_id, copy_id: copy.id }
    });

    return res.status(201).json({ loan });
  }

  const { data: digitalAsset, error: digitalAssetError } = await supabaseAdmin
    .from('digital_assets')
    .select('id,material_id,access_url,expires_at')
    .eq('material_id', parsed.data.material_id)
    .maybeSingle();

  if (digitalAssetError) {
    return sendError(res, 500, 'Unable to validate digital access', digitalAssetError.message);
  }

  if (!digitalAsset) {
    return sendError(res, 404, 'Digital asset not found for this material');
  }

  if (!profile.can_access_digital) {
    return sendError(res, 403, 'Digital access is disabled for this account');
  }

  const dueAt = new Date(Date.now() + getLoanDays(profile.member_type) * 24 * 60 * 60 * 1000).toISOString();
  const { data: loan, error: loanError } = await supabaseAdmin
    .from('loans')
    .insert({
      material_id: parsed.data.material_id,
      user_id: req.auth!.userId,
      processed_by: req.auth!.userId,
      loan_type: 'digital',
      status: 'active',
      due_at: dueAt,
      digital_access_until: digitalAsset.expires_at ?? dueAt
    })
    .select('*')
    .single();

  if (loanError) {
    return sendError(res, 500, 'Unable to create digital loan', loanError.message);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'circulation.loan.create',
    entityType: 'loan',
    entityId: loan.id,
    metadata: { loan_type: 'digital', material_id: parsed.data.material_id }
  });

  return res.status(201).json({ loan });
});

circulationRouter.post('/loans/:id/renew', requireAuth, async (req: AuthedRequest, res) => {
  const { data: loan, error: loanError } = await supabaseAdmin
    .from('loans')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();

  if (loanError) {
    return sendError(res, 500, 'Unable to load loan', loanError.message);
  }

  if (!loan) {
    return sendError(res, 404, 'Loan not found');
  }

  const canRenewAny = hasAnyPermission(req.auth?.permissions ?? [], 'loans:renew:any');
  const canRenewOwn = hasAnyPermission(req.auth?.permissions ?? [], 'loans:renew:own');
  if (loan.user_id !== req.auth!.userId && !canRenewAny) {
    return sendError(res, 403, 'You can only renew your own loans');
  }

  if (loan.user_id === req.auth!.userId && !canRenewOwn && !canRenewAny) {
    return sendError(res, 403, 'Insufficient permissions');
  }

  if (loan.status !== 'active') {
    return sendError(res, 409, 'Only active loans can be renewed');
  }

  const renewedCount = Number(loan.renewed_count || 0);
  if (renewedCount >= 2) {
    return sendError(res, 409, 'Renewal limit reached');
  }

  const dueAt = new Date(new Date(loan.due_at).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: renewed, error: renewError } = await supabaseAdmin
    .from('loans')
    .update({
      due_at: dueAt,
      renewed_count: renewedCount + 1,
      updated_at: new Date().toISOString()
    })
    .eq('id', loan.id)
    .select('*')
    .single();

  if (renewError) {
    return sendError(res, 500, 'Unable to renew loan', renewError.message);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'circulation.loan.renew',
    entityType: 'loan',
    entityId: renewed.id,
    metadata: { loan_user_id: loan.user_id, renewed_count: renewedCount + 1 }
  });

  return res.json({ loan: renewed });
});

circulationRouter.post('/loans/:id/return', requireAuth, async (req: AuthedRequest, res) => {
  const { data: loan, error: loanError } = await supabaseAdmin
    .from('loans')
    .select('*, material_copies(id,status)')
    .eq('id', req.params.id)
    .maybeSingle();

  if (loanError) {
    return sendError(res, 500, 'Unable to load loan', loanError.message);
  }

  if (!loan) {
    return sendError(res, 404, 'Loan not found');
  }

  const canReturnAny = hasAnyPermission(req.auth?.permissions ?? [], 'loans:return:any');
  const canReturnOwn = hasAnyPermission(req.auth?.permissions ?? [], 'loans:return:own');
  if (loan.user_id !== req.auth!.userId && !canReturnAny) {
    return sendError(res, 403, 'You can only return your own loans');
  }

  if (loan.user_id === req.auth!.userId && !canReturnOwn && !canReturnAny) {
    return sendError(res, 403, 'Insufficient permissions');
  }

  const now = new Date();
  const dueDate = new Date(loan.due_at);
  const overdueDays = Math.max(0, Math.ceil((now.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000)));

  const updates: Record<string, string> = {
    status: 'returned',
    returned_at: now.toISOString(),
    updated_at: now.toISOString()
  };

  const { data: returnedLoan, error: returnError } = await supabaseAdmin
    .from('loans')
    .update(updates)
    .eq('id', loan.id)
    .select('*')
    .single();

  if (returnError) {
    return sendError(res, 500, 'Unable to return loan', returnError.message);
  }

  if (loan.copy_id) {
    await supabaseAdmin
      .from('material_copies')
      .update({ status: 'available', updated_at: now.toISOString() })
      .eq('id', loan.copy_id);
  }

  if (overdueDays > 0) {
    const fineAmount = Number((overdueDays * getFineRatePerDay(loan.loan_type)).toFixed(2));
    await supabaseAdmin.from('fines').insert({
      loan_id: loan.id,
      user_id: loan.user_id,
      amount: fineAmount,
      status: 'open',
      reason: `Devolución con ${overdueDays} día(s) de retraso`,
      days_overdue: overdueDays,
      currency: 'BOB',
      due_at: now.toISOString(),
      processed_by: req.auth!.userId
    });
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'circulation.loan.return',
    entityType: 'loan',
    entityId: returnedLoan.id,
    metadata: { loan_user_id: loan.user_id, overdue_days: overdueDays }
  });

  return res.json({ loan: returnedLoan, overdueDays });
});

circulationRouter.post('/reservations', requireAuth, requireAnyPermission('reservations:create'), async (req: AuthedRequest, res) => {
  const parsed = reservationSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid reservation payload', parsed.error.flatten());
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id,reservation_limit,member_type,blocked_until')
    .eq('id', req.auth!.userId)
    .single();

  if (profileError) {
    return sendError(res, 400, 'Unable to load profile', profileError.message);
  }

  const { count, error: countError } = await supabaseAdmin
    .from('reservations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.auth!.userId)
    .in('status', ['queued', 'ready']);

  if (countError) {
    return sendError(res, 500, 'Unable to validate reservation limit', countError.message);
  }

  if ((count ?? 0) >= profile.reservation_limit) {
    return sendError(res, 409, 'Reservation limit reached');
  }

  if (isBlocked(profile.blocked_until)) {
    return sendError(res, 403, 'Account is temporarily blocked');
  }

  const { data: existingMaterialReservation } = await supabaseAdmin
    .from('reservations')
    .select('id')
    .eq('user_id', req.auth!.userId)
    .eq('material_id', parsed.data.material_id)
    .in('status', ['queued', 'ready'])
    .maybeSingle();

  if (existingMaterialReservation) {
    return sendError(res, 409, 'You already have an active reservation for this material');
  }

  const { data, error } = await supabaseAdmin
    .from('reservations')
    .insert({
      material_id: parsed.data.material_id,
      user_id: req.auth!.userId,
      queue_position: 1,
      status: 'queued',
      priority_score:
        hasAnyPermission(req.auth?.permissions ?? [], 'loans:create:physical', 'loans:create:digital')
          ? 5
          : profile.member_type === 'teacher'
            ? 4
            : profile.member_type === 'researcher'
              ? 3
              : 1
    })
    .select('*')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to create reservation', error.message);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'circulation.reservation.create',
    entityType: 'reservation',
    entityId: data.id,
    metadata: { material_id: parsed.data.material_id }
  });

  return res.status(201).json({ reservation: data });
});

circulationRouter.get('/reservations', requireAuth, requireAnyPermission('reservations:read:own', 'reservations:read:any'), async (req: AuthedRequest, res) => {
  const canReadAll = hasAnyPermission(req.auth?.permissions ?? [], 'reservations:read:any');
  let query = supabaseAdmin
    .from('reservations')
    .select('*, materials(id,title,kind,cover_url), profiles(id,full_name,member_type)')
    .order('reserved_at', { ascending: false });

  if (!canReadAll) {
    query = query.eq('user_id', req.auth!.userId);
  }

  const { data, error } = await query;
  if (error) {
    return sendError(res, 500, 'Unable to load reservations', error.message);
  }

  return res.json({ items: data ?? [] });
});

circulationRouter.post('/reservations/:id/cancel', requireAuth, async (req: AuthedRequest, res) => {
  const canCancelAny = hasAnyPermission(req.auth?.permissions ?? [], 'reservations:cancel:any');
  const canCancelOwn = hasAnyPermission(req.auth?.permissions ?? [], 'reservations:cancel:own');
  if (!canCancelAny && !canCancelOwn) {
    return sendError(res, 403, 'Insufficient permissions');
  }

  const { data, error } = await supabaseAdmin
    .from('reservations')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .match(canCancelAny ? {} : { user_id: req.auth!.userId })
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to cancel reservation', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Reservation not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'circulation.reservation.cancel',
    entityType: 'reservation',
    entityId: data.id,
    metadata: { user_id: data.user_id }
  });

  return res.json({ reservation: data });
});

circulationRouter.get('/fines', requireAuth, requireAnyPermission('fines:read:own', 'fines:read:any'), async (req: AuthedRequest, res) => {
  const canReadAll = hasAnyPermission(req.auth?.permissions ?? [], 'fines:read:any');
  let query = supabaseAdmin
    .from('fines')
    .select('*, loans(id,material_id,status,due_at,returned_at), profile:profiles!fines_user_id_fkey(id,full_name)')
    .order('issued_at', { ascending: false });

  if (!canReadAll) {
    query = query.eq('user_id', req.auth!.userId);
  }

  const { data, error } = await query;
  if (error) {
    return sendError(res, 500, 'Unable to load fines', error.message);
  }

  return res.json({ items: data ?? [] });
});

circulationRouter.post('/fines/:id/pay', requireAuth, requireAnyPermission('fines:pay:any'), async (req: AuthedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('fines')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to mark fine as paid', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Fine not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'circulation.fine.pay',
    entityType: 'fine',
    entityId: data.id,
    metadata: { status: data.status }
  });

  return res.json({ fine: data });
});
