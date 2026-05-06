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

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(2).max(120),
  member_type: z.enum(['public', 'student', 'teacher', 'researcher', 'staff']).default('public'),
  institution: z.string().max(180).nullable().optional(),
  department: z.string().max(180).nullable().optional(),
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
  const [materials, loans, reservations, fines, acquisitions, interlibrary, notifications] = await Promise.all([
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
  const { data, error } = await supabaseAdmin.from('roles').select('*').order('name', { ascending: true });
  if (error) {
    return sendError(res, 500, 'Unable to load roles', error.message);
  }

  return res.json({ items: data ?? [] });
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

adminRouter.get('/permissions', requireAuth, requireAnyPermission('permissions:manage'), async (_req, res) => {
  const { data, error } = await supabaseAdmin.from('permissions').select('*').order('name', { ascending: true });
  if (error) {
    return sendError(res, 500, 'Unable to load permissions', error.message);
  }

  return res.json({ items: data ?? [] });
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

adminRouter.get('/audit', requireAuth, requireAnyPermission('audit:read'), async (_req, res) => {
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

adminRouter.get('/analytics', requireAuth, requireAnyPermission('reports:view'), async (_req, res) => {
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
