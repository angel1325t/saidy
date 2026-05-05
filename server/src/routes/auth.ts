import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { sendError } from '../lib/http.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const authRouter = Router();

authRouter.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  const profile = req.auth?.profile;
  if (!profile) {
    return sendError(res, 404, 'Profile not found');
  }

  return res.json({ profile });
});

const updateProfileSchema = z.object({
  full_name: z.string().min(2).max(120).optional(),
  bio: z.string().max(800).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  institution: z.string().max(180).nullable().optional(),
  department: z.string().max(180).nullable().optional(),
  preferred_language: z.string().max(10).optional()
});

authRouter.patch('/me', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid profile payload', parsed.error.flatten());
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString()
    })
    .eq('id', req.auth!.userId)
    .select('*')
    .single();

  if (error) {
    return sendError(res, 400, 'Unable to update profile', error.message);
  }

  return res.json({ profile: data });
});
