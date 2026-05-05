import type { NextFunction, Request, Response } from 'express';
import { createSupabaseUserClient, supabaseAdmin } from './supabase.js';
import { getBearerToken, sendError } from './http.js';

export type AuthProfile = {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'librarian' | 'member';
  member_type: 'public' | 'student' | 'teacher' | 'researcher' | 'staff';
  blocked_until: string | null;
  can_access_digital: boolean;
  loan_limit: number;
  reservation_limit: number;
};

export type AuthedRequest = Request & {
  auth?: {
    userId: string;
    email: string;
    profile: AuthProfile | null;
    accessToken: string;
  };
};

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return sendError(res, 401, 'Missing bearer token');
  }

  const userClient = createSupabaseUserClient(accessToken);
  const { data, error } = await userClient.auth.getUser(accessToken);
  if (error || !data.user) {
    return sendError(res, 401, 'Invalid or expired token');
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id,email,full_name,role,member_type,blocked_until,can_access_digital,loan_limit,reservation_limit')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError) {
    return sendError(res, 500, 'Unable to load profile', profileError.message);
  }

  req.auth = {
    userId: data.user.id,
    email: data.user.email || profile?.email || '',
    profile: profile as AuthProfile | null,
    accessToken
  };

  return next();
}

export function requireRoles(...roles: Array<AuthProfile['role']>) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const role = req.auth?.profile?.role;
    if (!role || !roles.includes(role)) {
      return sendError(res, 403, 'Insufficient permissions');
    }
    return next();
  };
}
