import { Router } from 'express';
import { requireAuth, requireRoles, type AuthedRequest } from '../lib/auth.js';
import { sendError } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const adminRouter = Router();

adminRouter.get('/dashboard', requireAuth, requireRoles('admin', 'librarian'), async (_req, res) => {
  const [
    materials,
    loans,
    reservations,
    fines,
    acquisitions,
    interlibrary,
    notifications
  ] = await Promise.all([
    supabaseAdmin.from('materials').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('loans').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('reservations').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('fines').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('acquisition_requests').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('interlibrary_requests').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('notifications').select('id', { count: 'exact', head: true })
  ]);

  return res.json({
    materials: materials.count ?? 0,
    loans: loans.count ?? 0,
    reservations: reservations.count ?? 0,
    fines: fines.count ?? 0,
    acquisitions: acquisitions.count ?? 0,
    interlibrary: interlibrary.count ?? 0,
    notifications: notifications.count ?? 0
  });
});

adminRouter.get('/inventory', requireAuth, requireRoles('admin', 'librarian'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .select('*, material_copies(id,barcode,copy_code,status,location), materials(id,title,kind)')
    .order('counted_at', { ascending: false });

  if (error) {
    return sendError(res, 500, 'Unable to load inventory', error.message);
  }

  return res.json({ items: data ?? [] });
});

adminRouter.get('/acquisitions', requireAuth, requireRoles('admin', 'librarian'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('acquisition_requests')
    .select('*, profiles(id,full_name,role)')
    .order('requested_at', { ascending: false });

  if (error) {
    return sendError(res, 500, 'Unable to load acquisition requests', error.message);
  }

  return res.json({ items: data ?? [] });
});

adminRouter.get('/interlibrary', requireAuth, requireRoles('admin', 'librarian'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('interlibrary_requests')
    .select('*, profiles(id,full_name,role)')
    .order('requested_at', { ascending: false });

  if (error) {
    return sendError(res, 500, 'Unable to load interlibrary requests', error.message);
  }

  return res.json({ items: data ?? [] });
});

adminRouter.get('/audit', requireAuth, requireRoles('admin', 'librarian'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(250);

  if (error) {
    return sendError(res, 500, 'Unable to load audit logs', error.message);
  }

  return res.json({ items: data ?? [] });
});

adminRouter.get('/analytics', requireAuth, requireRoles('admin', 'librarian'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('analytics_snapshots')
    .select('*')
    .order('snapshot_date', { ascending: false })
    .limit(12);

  if (error) {
    return sendError(res, 500, 'Unable to load analytics', error.message);
  }

  return res.json({ items: data ?? [] });
});

adminRouter.get('/notifications', requireAuth, requireRoles('admin', 'librarian'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('*, profiles(id,full_name,role)')
    .order('created_at', { ascending: false })
    .limit(250);

  if (error) {
    return sendError(res, 500, 'Unable to load notifications', error.message);
  }

  return res.json({ items: data ?? [] });
});

adminRouter.post('/notifications', requireAuth, requireRoles('admin', 'librarian'), async (req: AuthedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: req.body.user_id,
      type: req.body.type ?? 'system',
      channel: req.body.channel ?? 'in_app',
      title: req.body.title,
      body: req.body.body,
      metadata: req.body.metadata ?? {},
      created_by: req.auth!.userId
    })
    .select('*')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to create notification', error.message);
  }

  return res.status(201).json({ notification: data });
});

adminRouter.post('/acquisitions', requireAuth, async (req: AuthedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('acquisition_requests')
    .insert({
      requested_by: req.auth!.userId,
      title: req.body.title,
      kind: req.body.kind,
      justification: req.body.justification,
      supplier: req.body.supplier,
      estimated_cost: req.body.estimated_cost ?? null,
      metadata: req.body.metadata ?? {}
    })
    .select('*')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to create acquisition request', error.message);
  }

  return res.status(201).json({ request: data });
});

adminRouter.post('/interlibrary', requireAuth, async (req: AuthedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('interlibrary_requests')
    .insert({
      requested_by: req.auth!.userId,
      material_title: req.body.material_title,
      external_library: req.body.external_library,
      notes: req.body.notes,
      metadata: req.body.metadata ?? {}
    })
    .select('*')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to create interlibrary request', error.message);
  }

  return res.status(201).json({ request: data });
});
