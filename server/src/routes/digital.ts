import { Router } from 'express';
import { logAuditEvent } from '../lib/audit.js';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { sendError } from '../lib/http.js';
import { requireAnyPermission } from '../lib/rbac.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const digitalRouter = Router();

digitalRouter.get('/assets', requireAuth, requireAnyPermission('digital:access'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('digital_assets')
    .select('*, materials(id,title,kind,cover_url)')
    .order('created_at', { ascending: false });

  if (error) {
    return sendError(res, 500, 'Unable to load digital assets', error.message);
  }

  return res.json({ items: data ?? [] });
});

digitalRouter.get('/materials/:id/access', requireAuth, requireAnyPermission('digital:access'), async (req: AuthedRequest, res) => {
  if (!req.auth?.profile?.can_access_digital) {
    return sendError(res, 403, 'Digital access is disabled for this account');
  }

  const { data, error } = await supabaseAdmin
    .from('digital_assets')
    .select('*, materials(id,title,kind)')
    .eq('material_id', req.params.id)
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to access digital material', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Digital asset not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'digital.access',
    entityType: 'digital_asset',
    entityId: data.id,
    metadata: { material_id: req.params.id }
  });

  return res.json({
    asset: data,
    access: {
      granted: true,
      expires_at: data.expires_at,
      viewer_id: req.auth!.userId
    }
  });
});
