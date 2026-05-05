import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { sendError } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const digitalRouter = Router();

digitalRouter.get('/assets', requireAuth, async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('digital_assets')
    .select('*, materials(id,title,kind,cover_url)')
    .order('created_at', { ascending: false });

  if (error) {
    return sendError(res, 500, 'Unable to load digital assets', error.message);
  }

  return res.json({ items: data ?? [] });
});

digitalRouter.get('/materials/:id/access', requireAuth, async (req: AuthedRequest, res) => {
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

  return res.json({
    asset: data,
    access: {
      granted: true,
      expires_at: data.expires_at,
      viewer_id: req.auth!.userId
    }
  });
});
