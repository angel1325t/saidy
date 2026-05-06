import type { NextFunction, Request, Response } from 'express';
import { createSupabaseUserClient, supabaseAdmin } from './supabase.js';
import { getBearerToken, sendError } from './http.js';
import type { PermissionRecord, RoleKey, RoleRecord } from './rbac.js';

export type AuthProfile = {
  id: string;
  email: string;
  full_name: string;
  member_type: 'public' | 'student' | 'teacher' | 'researcher' | 'staff';
  blocked_until: string | null;
  can_access_digital: boolean;
  loan_limit: number;
  reservation_limit: number;
  institution: string | null;
  department: string | null;
  bio: string | null;
  avatar_url: string | null;
  phone: string | null;
  preferred_language: string;
  roles: RoleRecord[];
  permissions: PermissionRecord[];
};

type LegacyProfileRow = AuthProfile & {
  role: string | null;
};

const roleNames: Record<RoleKey, string> = {
  ADMIN: 'Administrador',
  BIBLIOTECARIO: 'Bibliotecario',
  DOCENTE: 'Docente',
  INVESTIGADOR: 'Investigador',
  ESTUDIANTE: 'Estudiante'
};

const legacyPermissions: Record<RoleKey, string[]> = {
  ADMIN: [
    'catalog:read',
    'catalog:create',
    'catalog:update',
    'catalog:delete',
    'circulation:read:own',
    'circulation:read:any',
    'loans:create:physical',
    'loans:create:digital',
    'loans:renew:own',
    'loans:renew:any',
    'loans:return:own',
    'loans:return:any',
    'reservations:create',
    'reservations:read:own',
    'reservations:read:any',
    'reservations:cancel:own',
    'reservations:cancel:any',
    'fines:read:own',
    'fines:read:any',
    'fines:pay:any',
    'digital:access',
    'dashboard:view',
    'inventory:read',
    'inventory:manage',
    'reports:view',
    'notifications:manage',
    'audit:read',
    'users:read',
    'users:create',
    'users:update',
    'users:assign_roles',
    'roles:manage',
    'permissions:manage'
  ],
  BIBLIOTECARIO: [
    'catalog:read',
    'catalog:create',
    'catalog:update',
    'catalog:delete',
    'circulation:read:any',
    'loans:create:physical',
    'loans:create:digital',
    'loans:renew:any',
    'loans:return:any',
    'reservations:read:any',
    'reservations:cancel:any',
    'fines:read:any',
    'fines:pay:any',
    'digital:access',
    'dashboard:view',
    'inventory:read',
    'inventory:manage',
    'reports:view',
    'notifications:manage',
    'audit:read',
    'users:read'
  ],
  DOCENTE: [
    'catalog:read',
    'circulation:read:own',
    'loans:renew:own',
    'loans:return:own',
    'reservations:create',
    'reservations:read:own',
    'reservations:cancel:own',
    'fines:read:own',
    'digital:access'
  ],
  INVESTIGADOR: [
    'catalog:read',
    'circulation:read:own',
    'loans:renew:own',
    'loans:return:own',
    'reservations:create',
    'reservations:read:own',
    'reservations:cancel:own',
    'fines:read:own',
    'digital:access'
  ],
  ESTUDIANTE: [
    'catalog:read',
    'circulation:read:own',
    'loans:renew:own',
    'loans:return:own',
    'reservations:create',
    'reservations:read:own',
    'reservations:cancel:own',
    'fines:read:own',
    'digital:access'
  ]
};

function toRoleRecord(roleKey: RoleKey): RoleRecord {
  return {
    id: roleKey,
    key: roleKey,
    name: roleNames[roleKey],
    description: null
  };
}

function toPermissionRecords(permissionKeys: string[]): PermissionRecord[] {
  return permissionKeys.map((key) => ({
    id: key,
    key,
    name: key,
    description: null
  }));
}

function deriveLegacyRoleKeys(profile: { role?: string | null; member_type: AuthProfile['member_type'] }) {
  if (profile.role === 'admin') return ['ADMIN' as RoleKey];
  if (profile.role === 'librarian') return ['BIBLIOTECARIO' as RoleKey];

  switch (profile.member_type) {
    case 'teacher':
      return ['DOCENTE' as RoleKey];
    case 'researcher':
      return ['INVESTIGADOR' as RoleKey];
    case 'staff':
      return ['BIBLIOTECARIO' as RoleKey];
    default:
      return ['ESTUDIANTE' as RoleKey];
  }
}

function buildFallbackAuthorization(profile: { role?: string | null; member_type: AuthProfile['member_type'] }) {
  const roleKeys = deriveLegacyRoleKeys(profile);
  const permissionKeys = Array.from(new Set(roleKeys.flatMap((roleKey) => legacyPermissions[roleKey])));

  return {
    roles: roleKeys.map(toRoleRecord),
    permissions: toPermissionRecords(permissionKeys)
  };
}

export type AuthedRequest = Request & {
  auth?: {
    userId: string;
    email: string;
    roles: RoleRecord[];
    permissions: PermissionRecord[];
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
    .select(
      'id,email,full_name,member_type,blocked_until,can_access_digital,loan_limit,reservation_limit,institution,department,bio,avatar_url,phone,preferred_language'
    )
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError) {
    return sendError(res, 500, 'Unable to load profile', profileError.message);
  }

  const { data: roleRows, error: roleError } = await supabaseAdmin
    .from('user_roles')
    .select('role:roles(id,key,name,description)')
    .eq('user_id', data.user.id);

  if (roleError) {
    if (!roleError.message.toLowerCase().includes('does not exist')) {
      return sendError(res, 500, 'Unable to load roles', roleError.message);
    }

    const { data: legacyProfile, error: legacyProfileError } = await supabaseAdmin
      .from('profiles')
      .select(
        'id,email,full_name,role,member_type,blocked_until,can_access_digital,loan_limit,reservation_limit,institution,department,bio,avatar_url,phone,preferred_language'
      )
      .eq('id', data.user.id)
      .maybeSingle();

    if (legacyProfileError) {
      return sendError(res, 500, 'Unable to load legacy profile', legacyProfileError.message);
    }

    const fallback = buildFallbackAuthorization(legacyProfile as LegacyProfileRow);

    req.auth = {
      userId: data.user.id,
      email: data.user.email || legacyProfile?.email || '',
      roles: fallback.roles,
      permissions: fallback.permissions,
      profile: legacyProfile
        ? {
            ...legacyProfile,
            roles: fallback.roles,
            permissions: fallback.permissions
          }
        : null,
      accessToken
    };

    return next();
  }

  let roles = (((roleRows ?? []) as unknown as Array<{ role: RoleRecord | null }>)
    .map((row) => row.role)
    .filter(Boolean) as RoleRecord[]) ?? [];

  let permissions: PermissionRecord[] = [];
  const roleIds = roles.map((role) => role.id);
  const permissionsByKey = new Map<string, PermissionRecord>();

  if (roleIds.length > 0) {
    const { data: permissionRows, error: permissionError } = await supabaseAdmin
      .from('role_permissions')
      .select('permission:permissions(id,key,name,description)')
      .in('role_id', roleIds);

    if (permissionError) {
      return sendError(res, 500, 'Unable to load permissions', permissionError.message);
    }

    for (const row of (permissionRows ?? []) as unknown as Array<{ permission: PermissionRecord | null }>) {
      if (row.permission) {
        permissionsByKey.set(row.permission.key, row.permission as PermissionRecord);
      }
    }

    permissions = [...permissionsByKey.values()];
  }

  if (roles.length === 0) {
    const fallback = buildFallbackAuthorization({
      member_type: profile?.member_type ?? 'public'
    });
    roles = fallback.roles;
    permissions = fallback.permissions;
  }

  req.auth = {
    userId: data.user.id,
    email: data.user.email || profile?.email || '',
    roles,
    permissions,
    profile: profile
      ? {
          ...profile,
          roles,
          permissions
        }
      : null,
    accessToken
  };

  return next();
}

