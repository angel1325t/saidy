import { Router } from 'express';
import { z } from 'zod';
import { logAuditEvent } from '../lib/audit.js';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { sendError } from '../lib/http.js';
import { requireAnyPermission, type PermissionRecord, type RoleRecord } from '../lib/rbac.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const adminRouter = Router();

type UserDirectoryEntry = {
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
  created_at?: string;
  updated_at?: string;
  roles: RoleRecord[];
  permissions: PermissionRecord[];
};

type RoleDirectoryEntry = RoleRecord & {
  permissions: PermissionRecord[];
};

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(2).max(120),
  member_type: z.enum(['public', 'student', 'teacher', 'researcher', 'staff']).default('public'),
  institution: z.string().max(180).nullable().optional(),
  department: z.string().max(180).nullable().optional(),
  role_keys: z.array(z.string().min(2).max(80)).max(10).optional()
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  full_name: z.string().min(2).max(120).optional(),
  member_type: z.enum(['public', 'student', 'teacher', 'researcher', 'staff']).optional(),
  blocked_until: z.string().datetime().nullable().optional(),
  can_access_digital: z.boolean().optional(),
  loan_limit: z.coerce.number().int().min(0).optional(),
  reservation_limit: z.coerce.number().int().min(0).optional(),
  institution: z.string().max(180).nullable().optional(),
  department: z.string().max(180).nullable().optional(),
  bio: z.string().max(800).nullable().optional(),
  avatar_url: z.string().url().nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  preferred_language: z.string().max(10).optional(),
  role_keys: z.array(z.string().min(2).max(80)).max(10).optional()
});

const upsertRoleSchema = z.object({
  key: z.string().trim().min(2).max(80).regex(/^[A-Z0-9:_-]+$/),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).nullable().optional(),
  is_system: z.boolean().optional()
});

const upsertPermissionSchema = z.object({
  key: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).nullable().optional()
});

const setRolesSchema = z.object({
  role_keys: z.array(z.string().trim().min(2).max(80)).min(1).max(10)
});

const setPermissionsSchema = z.object({
  permission_keys: z.array(z.string().trim().min(2).max(120)).min(1).max(100)
});

const notificationPayloadSchema = z.object({
  user_id: z.string().uuid().nullable().optional(),
  type: z.string().trim().min(2).max(80).optional(),
  channel: z.enum(['in_app', 'email', 'sms']).optional(),
  title: z.string().min(2).max(200),
  body: z.string().min(2).max(4000),
  metadata: z.record(z.unknown()).optional()
});

const acquisitionPayloadSchema = z.object({
  title: z.string().min(2).max(200),
  kind: z.string().min(2).max(80),
  justification: z.string().max(4000).optional().nullable(),
  supplier: z.string().max(180).optional().nullable(),
  estimated_cost: z.coerce.number().nonnegative().optional().nullable(),
  metadata: z.record(z.unknown()).optional()
});

const interlibraryPayloadSchema = z.object({
  material_title: z.string().min(2).max(200),
  external_library: z.string().max(180).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  metadata: z.record(z.unknown()).optional()
});

const inventoryPayloadSchema = z.object({
  copy_id: z.string().uuid().optional().nullable(),
  material_id: z.string().uuid().optional().nullable(),
  location: z.string().max(180).optional().nullable(),
  condition_status: z.string().max(80).default('good'),
  is_missing: z.boolean().default(false),
  notes: z.string().max(2000).optional().nullable()
});

const acquisitionUpdateSchema = z.object({
  status: z.enum(['requested', 'approved', 'ordered', 'received', 'cancelled']).optional(),
  justification: z.string().max(4000).optional().nullable(),
  supplier: z.string().max(180).optional().nullable(),
  estimated_cost: z.coerce.number().nonnegative().optional().nullable(),
  metadata: z.record(z.unknown()).optional()
});

const interlibraryUpdateSchema = z.object({
  status: z.enum(['requested', 'approved', 'shipped', 'received', 'returned', 'cancelled']).optional(),
  external_library: z.string().max(180).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  metadata: z.record(z.unknown()).optional()
});

const notificationUpdateSchema = z.object({
  read_at: z.string().datetime().nullable().optional(),
  title: z.string().min(2).max(200).optional(),
  body: z.string().min(2).max(4000).optional(),
  metadata: z.record(z.unknown()).optional()
});

function getParamId(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : null;
}

async function loadUserDirectory(): Promise<UserDirectoryEntry[]> {
  const { data: profiles, error } = await supabaseAdmin
    .from('profiles')
    .select(
      'id,email,full_name,member_type,blocked_until,can_access_digital,loan_limit,reservation_limit,institution,department,bio,avatar_url,phone,preferred_language,created_at,updated_at'
    )
    .order('full_name', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const userIds = (profiles ?? []).map((profile) => profile.id);
  if (userIds.length === 0) {
    return [];
  }

  const { data: roleLinks, error: roleError } = await supabaseAdmin
    .from('user_roles')
    .select('user_id, role:roles(id,key,name,description)')
    .in('user_id', userIds);

  if (roleError) {
    throw new Error(roleError.message);
  }

  const typedRoleLinks = (roleLinks ?? []) as unknown as Array<{ user_id: string; role: RoleRecord | null }>;

  const roleIds = Array.from(
    new Set(
      typedRoleLinks
        .map((row) => row.role)
        .filter((role): role is RoleRecord => Boolean(role))
        .map((role) => role.id)
    )
  );

  let permissionLinks: Array<{ role_id: string; permission: PermissionRecord | null }> = [];
  if (roleIds.length > 0) {
    const { data, error: permissionError } = await supabaseAdmin
      .from('role_permissions')
      .select('role_id, permission:permissions(id,key,name,description)')
      .in('role_id', roleIds);

    if (permissionError) {
      throw new Error(permissionError.message);
    }

    permissionLinks = (data ?? []) as unknown as Array<{ role_id: string; permission: PermissionRecord | null }>;
  }

  const rolesByUser = new Map<string, RoleRecord[]>();
  const permissionsByRole = new Map<string, PermissionRecord[]>();

  for (const link of typedRoleLinks) {
    if (!link.role) continue;
    const current = rolesByUser.get(link.user_id) ?? [];
    current.push(link.role as RoleRecord);
    rolesByUser.set(link.user_id, current);
  }

  for (const link of permissionLinks) {
    if (!link.permission) continue;
    const current = permissionsByRole.get(link.role_id) ?? [];
    if (!current.some((permission) => permission.key === link.permission?.key)) {
      current.push(link.permission);
    }
    permissionsByRole.set(link.role_id, current);
  }

  return (profiles ?? []).map((profile) => {
    const roles = rolesByUser.get(profile.id) ?? [];
    const permissions = new Map<string, PermissionRecord>();

    for (const role of roles) {
      for (const permission of permissionsByRole.get(role.id) ?? []) {
        permissions.set(permission.key, permission);
      }
    }

    return {
      ...profile,
      roles,
      permissions: [...permissions.values()]
    };
  });
}

async function loadRoleDirectory(): Promise<RoleDirectoryEntry[]> {
  const { data: roles, error } = await supabaseAdmin.from('roles').select('*').order('name', { ascending: true });
  if (error) {
    throw new Error(error.message);
  }

  const roleIds = (roles ?? []).map((role) => role.id);
  if (roleIds.length === 0) {
    return [];
  }

  const { data: permissionLinks, error: permissionError } = await supabaseAdmin
    .from('role_permissions')
    .select('role_id, permission:permissions(id,key,name,description)')
    .in('role_id', roleIds);

  if (permissionError) {
    throw new Error(permissionError.message);
  }

  const permissionsByRole = new Map<string, PermissionRecord[]>();
  for (const link of (permissionLinks ?? []) as unknown as Array<{ role_id: string; permission: PermissionRecord | null }>) {
    if (!link.permission) continue;
    const current = permissionsByRole.get(link.role_id) ?? [];
    if (!current.some((permission) => permission.key === link.permission?.key)) {
      current.push(link.permission);
    }
    permissionsByRole.set(link.role_id, current);
  }

  return (roles ?? []).map((role) => ({
    ...role,
    permissions: permissionsByRole.get(role.id) ?? []
  }));
}

async function resolveRoleIds(roleKeys: string[]) {
  const { data, error } = await supabaseAdmin.from('roles').select('id,key').in('key', roleKeys);
  if (error) {
    throw new Error(error.message);
  }

  const rolesByKey = new Map((data ?? []).map((role) => [role.key, role.id] as const));
  const missing = roleKeys.filter((roleKey) => !rolesByKey.has(roleKey));
  if (missing.length > 0) {
    throw new Error(`Unknown role(s): ${missing.join(', ')}`);
  }

  return roleKeys.map((roleKey) => rolesByKey.get(roleKey) as string);
}

async function resolvePermissionIds(permissionKeys: string[]) {
  const { data, error } = await supabaseAdmin.from('permissions').select('id,key').in('key', permissionKeys);
  if (error) {
    throw new Error(error.message);
  }

  const permissionsByKey = new Map((data ?? []).map((permission) => [permission.key, permission.id] as const));
  const missing = permissionKeys.filter((permissionKey) => !permissionsByKey.has(permissionKey));
  if (missing.length > 0) {
    throw new Error(`Unknown permission(s): ${missing.join(', ')}`);
  }

  return permissionKeys.map((permissionKey) => permissionsByKey.get(permissionKey) as string);
}

adminRouter.get('/dashboard', requireAuth, requireAnyPermission('dashboard:view'), async (_req, res) => {
  const [materials, loans, reservations, fines, inventory, acquisitions, interlibrary, notifications] = await Promise.all([
    supabaseAdmin.from('materials').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('loans').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('reservations').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('fines').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('inventory_items').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('acquisition_requests').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('interlibrary_requests').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('notifications').select('id', { count: 'exact', head: true })
  ]);

  return res.json({
    materials: materials.count ?? 0,
    loans: loans.count ?? 0,
    reservations: reservations.count ?? 0,
    fines: fines.count ?? 0,
    inventory: inventory.count ?? 0,
    acquisitions: acquisitions.count ?? 0,
    interlibrary: interlibrary.count ?? 0,
    notifications: notifications.count ?? 0
  });
});

adminRouter.get('/users', requireAuth, requireAnyPermission('users:read'), async (_req, res) => {
  try {
    return res.json({ items: await loadUserDirectory() });
  } catch (error) {
    return sendError(res, 500, 'Unable to load users', error instanceof Error ? error.message : 'Unknown error');
  }
});

adminRouter.post('/users', requireAuth, requireAnyPermission('users:create'), async (req: AuthedRequest, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid user payload', parsed.error.flatten());
  }

  const { role_keys = [] } = parsed.data;

  const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: {
      full_name: parsed.data.full_name,
      member_type: parsed.data.member_type,
      institution: parsed.data.institution,
      department: parsed.data.department
    }
  });

  if (createError || !createdUser.user) {
    return sendError(res, 500, 'Unable to create user', createError?.message ?? 'Unknown error');
  }

  try {
    if (role_keys.length > 0) {
      const roleIds = await resolveRoleIds(role_keys);

      await supabaseAdmin.from('user_roles').delete().eq('user_id', createdUser.user.id);
      const { error: assignError } = await supabaseAdmin.from('user_roles').insert(
        roleIds.map((roleId) => ({
          user_id: createdUser.user.id,
          role_id: roleId,
          assigned_by: req.auth!.userId
        }))
      );

      if (assignError) {
        return sendError(res, 500, 'Unable to assign roles', assignError.message);
      }
    }

    await logAuditEvent({
      actorId: req.auth!.userId,
      action: 'users.create',
      entityType: 'user',
      entityId: createdUser.user.id,
      metadata: {
        email: parsed.data.email,
        role_keys
      }
    });

    return res.status(201).json({ user: createdUser.user });
  } catch (error) {
    return sendError(res, 400, 'Unable to resolve roles', error instanceof Error ? error.message : 'Unknown error');
  }
});

adminRouter.get('/users/:id', requireAuth, requireAnyPermission('users:read'), async (req, res) => {
  try {
    const user = (await loadUserDirectory()).find((item) => item.id === req.params.id);
    if (!user) {
      return sendError(res, 404, 'User not found');
    }

    return res.json({ user });
  } catch (error) {
    return sendError(res, 500, 'Unable to load user', error instanceof Error ? error.message : 'Unknown error');
  }
});

adminRouter.patch('/users/:id', requireAuth, requireAnyPermission('users:update'), async (req: AuthedRequest, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid user payload', parsed.error.flatten());
  }

  const { role_keys, ...profileUpdates } = parsed.data;
  const targetUserId = getParamId(req.params.id);
  if (!targetUserId) {
    return sendError(res, 400, 'Invalid user id');
  }

  if (Object.keys(profileUpdates).length > 0) {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        ...profileUpdates,
        updated_at: new Date().toISOString()
      })
      .eq('id', targetUserId);

    if (error) {
      return sendError(res, 500, 'Unable to update user profile', error.message);
    }
  }

  if (role_keys) {
    if (!req.auth?.permissions.some((permission) => permission.key === 'users:assign_roles')) {
      return sendError(res, 403, 'Insufficient permissions to assign roles');
    }

    try {
      const roleIds = await resolveRoleIds(role_keys);
      const { error: deleteError } = await supabaseAdmin.from('user_roles').delete().eq('user_id', targetUserId);
      if (deleteError) {
        return sendError(res, 500, 'Unable to replace user roles', deleteError.message);
      }

      if (roleIds.length > 0) {
        const { error: insertError } = await supabaseAdmin.from('user_roles').insert(
          roleIds.map((roleId) => ({
            user_id: targetUserId,
            role_id: roleId,
            assigned_by: req.auth!.userId
          }))
        );

        if (insertError) {
          return sendError(res, 500, 'Unable to assign roles', insertError.message);
        }
      }
    } catch (error) {
      return sendError(res, 400, 'Unable to resolve roles', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'users.update',
    entityType: 'user',
    entityId: targetUserId,
    metadata: { changed_fields: Object.keys(parsed.data) }
  });

  const user = (await loadUserDirectory()).find((item) => item.id === targetUserId);
  return res.json({ user });
});

adminRouter.delete('/users/:id', requireAuth, requireAnyPermission('users:update'), async (req: AuthedRequest, res) => {
  const blockedUntil = '2999-12-31T23:59:59.000Z';
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({
      blocked_until: blockedUntil,
      updated_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to archive user', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'User not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'users.archive',
    entityType: 'user',
    entityId: data.id,
    metadata: { blocked_until: blockedUntil }
  });

  return res.json({ user: data });
});

adminRouter.patch('/users/:id/roles', requireAuth, requireAnyPermission('users:assign_roles'), async (req: AuthedRequest, res) => {
  const parsed = setRolesSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid roles payload', parsed.error.flatten());
  }

  const targetUserId = getParamId(req.params.id);
  if (!targetUserId) {
    return sendError(res, 400, 'Invalid user id');
  }

  try {
    const roleIds = await resolveRoleIds(parsed.data.role_keys);
    const { error: deleteError } = await supabaseAdmin.from('user_roles').delete().eq('user_id', targetUserId);
    if (deleteError) {
      return sendError(res, 500, 'Unable to replace user roles', deleteError.message);
    }

    const { error: insertError } = await supabaseAdmin.from('user_roles').insert(
      roleIds.map((roleId) => ({
        user_id: targetUserId,
        role_id: roleId,
        assigned_by: req.auth!.userId
      }))
    );

    if (insertError) {
      return sendError(res, 500, 'Unable to assign roles', insertError.message);
    }

    await logAuditEvent({
      actorId: req.auth!.userId,
      action: 'users.assign_roles',
      entityType: 'user',
      entityId: targetUserId,
      metadata: { role_keys: parsed.data.role_keys }
    });

    return res.json({ user_id: targetUserId, role_keys: parsed.data.role_keys });
  } catch (error) {
    return sendError(res, 400, 'Unable to resolve roles', error instanceof Error ? error.message : 'Unknown error');
  }
});

adminRouter.get('/roles', requireAuth, requireAnyPermission('roles:manage'), async (_req, res) => {
  try {
    return res.json({ items: await loadRoleDirectory() });
  } catch (error) {
    return sendError(res, 500, 'Unable to load roles', error instanceof Error ? error.message : 'Unknown error');
  }
});

adminRouter.get('/roles/:id', requireAuth, requireAnyPermission('roles:manage'), async (req, res) => {
  try {
    const role = (await loadRoleDirectory()).find((item) => item.id === req.params.id);
    if (!role) {
      return sendError(res, 404, 'Role not found');
    }

    return res.json({ role });
  } catch (error) {
    return sendError(res, 500, 'Unable to load role', error instanceof Error ? error.message : 'Unknown error');
  }
});

adminRouter.post('/roles', requireAuth, requireAnyPermission('roles:manage'), async (req: AuthedRequest, res) => {
  const parsed = upsertRoleSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid role payload', parsed.error.flatten());
  }

  const { data, error } = await supabaseAdmin
    .from('roles')
    .insert({
      ...parsed.data,
      is_system: parsed.data.is_system ?? false
    })
    .select('*')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to create role', error.message);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'roles.create',
    entityType: 'role',
    entityId: data.id,
    metadata: { key: data.key }
  });

  return res.status(201).json({ role: data });
});

adminRouter.patch('/roles/:id', requireAuth, requireAnyPermission('roles:manage'), async (req: AuthedRequest, res) => {
  const parsed = upsertRoleSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid role payload', parsed.error.flatten());
  }

  const roleId = getParamId(req.params.id);
  if (!roleId) {
    return sendError(res, 400, 'Invalid role id');
  }

  const { data, error } = await supabaseAdmin
    .from('roles')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString()
    })
    .eq('id', roleId)
    .select('*')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to update role', error.message);
  }

    await logAuditEvent({
      actorId: req.auth!.userId,
      action: 'roles.update',
      entityType: 'role',
      entityId: roleId,
      metadata: { key: data.key }
    });

  return res.json({ role: data });
});

adminRouter.delete('/roles/:id', requireAuth, requireAnyPermission('roles:manage'), async (req: AuthedRequest, res) => {
  const { data: existing, error: loadError } = await supabaseAdmin
    .from('roles')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();

  if (loadError) {
    return sendError(res, 500, 'Unable to load role', loadError.message);
  }

  if (!existing) {
    return sendError(res, 404, 'Role not found');
  }

  if (existing.is_system) {
    return sendError(res, 409, 'System roles cannot be deleted');
  }

  await supabaseAdmin.from('role_permissions').delete().eq('role_id', req.params.id);
  await supabaseAdmin.from('user_roles').delete().eq('role_id', req.params.id);

  const { error } = await supabaseAdmin.from('roles').delete().eq('id', req.params.id);
  if (error) {
    return sendError(res, 500, 'Unable to delete role', error.message);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'roles.delete',
    entityType: 'role',
    entityId: getParamId(req.params.id) ?? undefined,
    metadata: { key: existing.key }
  });

  return res.json({ role: existing });
});

adminRouter.get('/permissions', requireAuth, requireAnyPermission('permissions:manage'), async (_req, res) => {
  const { data, error } = await supabaseAdmin.from('permissions').select('*').order('name', { ascending: true });
  if (error) {
    return sendError(res, 500, 'Unable to load permissions', error.message);
  }

  return res.json({ items: data ?? [] });
});

adminRouter.get('/permissions/:id', requireAuth, requireAnyPermission('permissions:manage'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('permissions')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to load permission', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Permission not found');
  }

  return res.json({ permission: data });
});

adminRouter.post('/permissions', requireAuth, requireAnyPermission('permissions:manage'), async (req: AuthedRequest, res) => {
  const parsed = upsertPermissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid permission payload', parsed.error.flatten());
  }

  const { data, error } = await supabaseAdmin.from('permissions').insert(parsed.data).select('*').single();
  if (error) {
    return sendError(res, 500, 'Unable to create permission', error.message);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'permissions.create',
    entityType: 'permission',
    entityId: data.id,
    metadata: { key: data.key }
  });

  return res.status(201).json({ permission: data });
});

adminRouter.patch('/permissions/:id', requireAuth, requireAnyPermission('permissions:manage'), async (req: AuthedRequest, res) => {
  const parsed = upsertPermissionSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid permission payload', parsed.error.flatten());
  }

  const permissionId = getParamId(req.params.id);
  if (!permissionId) {
    return sendError(res, 400, 'Invalid permission id');
  }

  const { data, error } = await supabaseAdmin
    .from('permissions')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString()
    })
    .eq('id', permissionId)
    .select('*')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to update permission', error.message);
  }

    await logAuditEvent({
      actorId: req.auth!.userId,
      action: 'permissions.update',
      entityType: 'permission',
      entityId: permissionId,
      metadata: { key: data.key }
    });

  return res.json({ permission: data });
});

adminRouter.delete('/permissions/:id', requireAuth, requireAnyPermission('permissions:manage'), async (req: AuthedRequest, res) => {
  const { data: existing, error: loadError } = await supabaseAdmin
    .from('permissions')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();

  if (loadError) {
    return sendError(res, 500, 'Unable to load permission', loadError.message);
  }

  if (!existing) {
    return sendError(res, 404, 'Permission not found');
  }

  await supabaseAdmin.from('role_permissions').delete().eq('permission_id', req.params.id);
  const { error } = await supabaseAdmin.from('permissions').delete().eq('id', req.params.id);
  if (error) {
    return sendError(res, 500, 'Unable to delete permission', error.message);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'permissions.delete',
    entityType: 'permission',
    entityId: getParamId(req.params.id) ?? undefined,
    metadata: { key: existing.key }
  });

  return res.json({ permission: existing });
});

adminRouter.put('/roles/:id/permissions', requireAuth, requireAnyPermission('permissions:manage'), async (req: AuthedRequest, res) => {
  const parsed = setPermissionsSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid permissions payload', parsed.error.flatten());
  }

  const roleId = getParamId(req.params.id);
  if (!roleId) {
    return sendError(res, 400, 'Invalid role id');
  }

  try {
    const permissionIds = await resolvePermissionIds(parsed.data.permission_keys);

    const { error: deleteError } = await supabaseAdmin.from('role_permissions').delete().eq('role_id', roleId);
    if (deleteError) {
      return sendError(res, 500, 'Unable to replace role permissions', deleteError.message);
    }

    const { error: insertError } = await supabaseAdmin.from('role_permissions').insert(
      permissionIds.map((permissionId) => ({
        role_id: roleId,
        permission_id: permissionId,
        granted_by: req.auth!.userId
      }))
    );

    if (insertError) {
      return sendError(res, 500, 'Unable to assign permissions', insertError.message);
    }

    await logAuditEvent({
      actorId: req.auth!.userId,
      action: 'roles.update_permissions',
      entityType: 'role',
      entityId: roleId,
      metadata: { permission_keys: parsed.data.permission_keys }
    });

    return res.json({ role_id: roleId, permission_keys: parsed.data.permission_keys });
  } catch (error) {
    return sendError(res, 400, 'Unable to resolve permissions', error instanceof Error ? error.message : 'Unknown error');
  }
});

adminRouter.get('/inventory', requireAuth, requireAnyPermission('inventory:read', 'inventory:manage'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .select('*, material_copies(id,barcode,copy_code,status,location), materials(id,title,kind)')
    .order('counted_at', { ascending: false });

  if (error) {
    return sendError(res, 500, 'Unable to load inventory', error.message);
  }

  return res.json({ items: data ?? [] });
});

adminRouter.get('/inventory/:id', requireAuth, requireAnyPermission('inventory:read', 'inventory:manage'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .select('*, material_copies(id,barcode,copy_code,status,location), materials(id,title,kind)')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to load inventory record', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Inventory record not found');
  }

  return res.json({ item: data });
});

adminRouter.get('/acquisitions', requireAuth, requireAnyPermission('reports:view'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('acquisition_requests')
    .select('*, profiles(id,full_name)')
    .order('requested_at', { ascending: false });

  if (error) {
    return sendError(res, 500, 'Unable to load acquisition requests', error.message);
  }

  return res.json({ items: data ?? [] });
});

adminRouter.get('/acquisitions/:id', requireAuth, requireAnyPermission('reports:view'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('acquisition_requests')
    .select('*, profiles(id,full_name)')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to load acquisition request', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Acquisition request not found');
  }

  return res.json({ request: data });
});

adminRouter.get('/interlibrary', requireAuth, requireAnyPermission('reports:view'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('interlibrary_requests')
    .select('*, profiles(id,full_name)')
    .order('requested_at', { ascending: false });

  if (error) {
    return sendError(res, 500, 'Unable to load interlibrary requests', error.message);
  }

  return res.json({ items: data ?? [] });
});

adminRouter.get('/interlibrary/:id', requireAuth, requireAnyPermission('reports:view'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('interlibrary_requests')
    .select('*, profiles(id,full_name)')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to load interlibrary request', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Interlibrary request not found');
  }

  return res.json({ request: data });
});

adminRouter.get('/audit', requireAuth, requireAnyPermission('audit:read'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('audit_logs')
    .select('*, actor:profiles(id,full_name,email)')
    .order('created_at', { ascending: false })
    .limit(250);

  if (error) {
    return sendError(res, 500, 'Unable to load audit logs', error.message);
  }

  return res.json({ items: data ?? [] });
});

adminRouter.get('/analytics', requireAuth, requireAnyPermission('reports:view'), async (_req, res) => {
  const [snapshots, activeLoans, overdueLoans, digitalLoans, openFines, borrowedCopies] = await Promise.all([
    supabaseAdmin.from('analytics_snapshots').select('*').order('snapshot_date', { ascending: false }).limit(12),
    supabaseAdmin.from('loans').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabaseAdmin.from('loans').select('id', { count: 'exact', head: true }).eq('status', 'overdue'),
    supabaseAdmin.from('loans').select('id', { count: 'exact', head: true }).eq('loan_type', 'digital'),
    supabaseAdmin.from('fines').select('id', { count: 'exact', head: true }).in('status', ['open', 'pending_payment']),
    supabaseAdmin.from('material_copies').select('id', { count: 'exact', head: true }).eq('status', 'borrowed')
  ]);

  if (snapshots.error) {
    return sendError(res, 500, 'Unable to load analytics', snapshots.error.message);
  }

  return res.json({
    items: snapshots.data ?? [],
    summary: {
      active_loans: activeLoans.count ?? 0,
      overdue_loans: overdueLoans.count ?? 0,
      digital_loans: digitalLoans.count ?? 0,
      open_fines: openFines.count ?? 0,
      borrowed_copies: borrowedCopies.count ?? 0
    }
  });
});

adminRouter.get('/notifications', requireAuth, requireAnyPermission('notifications:manage'), async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('*, profiles(id,full_name)')
    .order('created_at', { ascending: false })
    .limit(250);

  if (error) {
    return sendError(res, 500, 'Unable to load notifications', error.message);
  }

  return res.json({ items: data ?? [] });
});

adminRouter.get('/notifications/:id', requireAuth, requireAnyPermission('notifications:manage'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('*, profiles(id,full_name)')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to load notification', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Notification not found');
  }

  return res.json({ notification: data });
});

adminRouter.post('/notifications', requireAuth, requireAnyPermission('notifications:manage'), async (req: AuthedRequest, res) => {
  const parsed = notificationPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid notification payload', parsed.error.flatten());
  }

  const { data, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: parsed.data.user_id ?? null,
      type: parsed.data.type ?? 'system',
      channel: parsed.data.channel ?? 'in_app',
      title: parsed.data.title,
      body: parsed.data.body,
      metadata: parsed.data.metadata ?? {},
      created_by: req.auth!.userId
    })
    .select('*')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to create notification', error.message);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'notifications.create',
    entityType: 'notification',
    entityId: data.id,
    metadata: { user_id: parsed.data.user_id, type: parsed.data.type ?? 'system' }
  });

  return res.status(201).json({ notification: data });
});

adminRouter.patch('/notifications/:id', requireAuth, requireAnyPermission('notifications:manage'), async (req: AuthedRequest, res) => {
  const parsed = notificationUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid notification payload', parsed.error.flatten());
  }

  const { data, error } = await supabaseAdmin
    .from('notifications')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to update notification', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Notification not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'notifications.update',
    entityType: 'notification',
    entityId: data.id,
    metadata: { read_at: data.read_at }
  });

  return res.json({ notification: data });
});

adminRouter.delete('/notifications/:id', requireAuth, requireAnyPermission('notifications:manage'), async (req: AuthedRequest, res) => {
  const now = new Date().toISOString();
  const { data: existing, error: loadError } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();

  if (loadError) {
    return sendError(res, 500, 'Unable to load notification', loadError.message);
  }

  if (!existing) {
    return sendError(res, 404, 'Notification not found');
  }

  const { data, error } = await supabaseAdmin
    .from('notifications')
    .update({
      read_at: existing.read_at ?? now,
      metadata: {
        ...(existing.metadata ?? {}),
        archived: true,
        archived_at: now
      },
      updated_at: now
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to archive notification', error.message);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'notifications.archive',
    entityType: 'notification',
    entityId: getParamId(req.params.id) ?? undefined,
    metadata: { archived_at: now }
  });

  return res.json({ notification: data });
});

adminRouter.post('/inventory', requireAuth, requireAnyPermission('inventory:manage'), async (req: AuthedRequest, res) => {
  const parsed = inventoryPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid inventory payload', parsed.error.flatten());
  }

  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .insert(parsed.data)
    .select('*, material_copies(id,barcode,copy_code,status,location), materials(id,title,kind)')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to create inventory record', error.message);
  }

  if (parsed.data.copy_id) {
    const copyUpdate: Record<string, unknown> = {
      last_audited_at: new Date().toISOString()
    };
    if (parsed.data.is_missing) {
      copyUpdate.status = 'lost';
    }
    if (parsed.data.location) {
      copyUpdate.location = parsed.data.location;
    }
    if (parsed.data.notes) {
      copyUpdate.condition_note = parsed.data.notes;
    }

    await supabaseAdmin
      .from('material_copies')
      .update(copyUpdate)
      .eq('id', parsed.data.copy_id);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'inventory.create',
    entityType: 'inventory_item',
    entityId: data.id,
    metadata: { copy_id: parsed.data.copy_id, material_id: parsed.data.material_id, is_missing: parsed.data.is_missing }
  });

  return res.status(201).json({ item: data });
});

adminRouter.patch('/inventory/:id', requireAuth, requireAnyPermission('inventory:manage'), async (req: AuthedRequest, res) => {
  const parsed = inventoryPayloadSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid inventory payload', parsed.error.flatten());
  }

  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select('*, material_copies(id,barcode,copy_code,status,location), materials(id,title,kind)')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to update inventory record', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Inventory record not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'inventory.update',
    entityType: 'inventory_item',
    entityId: data.id,
    metadata: { copy_id: data.copy_id, material_id: data.material_id, is_missing: data.is_missing }
  });

  return res.json({ item: data });
});

adminRouter.delete('/inventory/:id', requireAuth, requireAnyPermission('inventory:manage'), async (req: AuthedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .update({
      is_missing: true,
      notes: 'Archived through DELETE /inventory/:id',
      updated_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select('*, material_copies(id,barcode,copy_code,status,location), materials(id,title,kind)')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to archive inventory record', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Inventory record not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'inventory.archive',
    entityType: 'inventory_item',
    entityId: data.id,
    metadata: { is_missing: data.is_missing }
  });

  return res.json({ item: data });
});

adminRouter.post('/acquisitions', requireAuth, requireAnyPermission('reports:view'), async (req: AuthedRequest, res) => {
  const parsed = acquisitionPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid acquisition payload', parsed.error.flatten());
  }

  const { data, error } = await supabaseAdmin
    .from('acquisition_requests')
    .insert({
      requested_by: req.auth!.userId,
      title: parsed.data.title,
      kind: parsed.data.kind,
      justification: parsed.data.justification ?? null,
      supplier: parsed.data.supplier ?? null,
      estimated_cost: parsed.data.estimated_cost ?? null,
      metadata: parsed.data.metadata ?? {}
    })
    .select('*')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to create acquisition request', error.message);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'acquisitions.create',
    entityType: 'acquisition_request',
    entityId: data.id,
    metadata: { title: parsed.data.title }
  });

  return res.status(201).json({ request: data });
});

adminRouter.patch('/acquisitions/:id', requireAuth, requireAnyPermission('reports:view'), async (req: AuthedRequest, res) => {
  const parsed = acquisitionUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid acquisition payload', parsed.error.flatten());
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('acquisition_requests')
    .update({
      ...parsed.data,
      approved_at: parsed.data.status === 'approved' ? now : undefined,
      received_at: parsed.data.status === 'received' ? now : undefined,
      updated_at: now
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to update acquisition request', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Acquisition request not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'acquisitions.update',
    entityType: 'acquisition_request',
    entityId: data.id,
    metadata: { status: data.status, title: data.title }
  });

  return res.json({ request: data });
});

adminRouter.delete('/acquisitions/:id', requireAuth, requireAnyPermission('reports:view'), async (req: AuthedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('acquisition_requests')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to archive acquisition request', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Acquisition request not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'acquisitions.archive',
    entityType: 'acquisition_request',
    entityId: data.id,
    metadata: { status: data.status, title: data.title }
  });

  return res.json({ request: data });
});

adminRouter.post('/interlibrary', requireAuth, requireAnyPermission('reports:view'), async (req: AuthedRequest, res) => {
  const parsed = interlibraryPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid interlibrary payload', parsed.error.flatten());
  }

  const { data, error } = await supabaseAdmin
    .from('interlibrary_requests')
    .insert({
      requested_by: req.auth!.userId,
      material_title: parsed.data.material_title,
      external_library: parsed.data.external_library ?? null,
      notes: parsed.data.notes ?? null,
      metadata: parsed.data.metadata ?? {}
    })
    .select('*')
    .single();

  if (error) {
    return sendError(res, 500, 'Unable to create interlibrary request', error.message);
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'interlibrary.create',
    entityType: 'interlibrary_request',
    entityId: data.id,
    metadata: { material_title: parsed.data.material_title }
  });

  return res.status(201).json({ request: data });
});

adminRouter.patch('/interlibrary/:id', requireAuth, requireAnyPermission('reports:view'), async (req: AuthedRequest, res) => {
  const parsed = interlibraryUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, 'Invalid interlibrary payload', parsed.error.flatten());
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('interlibrary_requests')
    .update({
      ...parsed.data,
      fulfilled_at: parsed.data.status === 'received' ? now : undefined,
      returned_at: parsed.data.status === 'returned' ? now : undefined,
      updated_at: now
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to update interlibrary request', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Interlibrary request not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'interlibrary.update',
    entityType: 'interlibrary_request',
    entityId: data.id,
    metadata: { status: data.status, material_title: data.material_title }
  });

  return res.json({ request: data });
});

adminRouter.delete('/interlibrary/:id', requireAuth, requireAnyPermission('reports:view'), async (req: AuthedRequest, res) => {
  const { data, error } = await supabaseAdmin
    .from('interlibrary_requests')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
    .eq('id', req.params.id)
    .select('*')
    .maybeSingle();

  if (error) {
    return sendError(res, 500, 'Unable to archive interlibrary request', error.message);
  }

  if (!data) {
    return sendError(res, 404, 'Interlibrary request not found');
  }

  await logAuditEvent({
    actorId: req.auth!.userId,
    action: 'interlibrary.archive',
    entityType: 'interlibrary_request',
    entityId: data.id,
    metadata: { status: data.status, material_title: data.material_title }
  });

  return res.json({ request: data });
});
