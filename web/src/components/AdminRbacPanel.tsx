import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api.js';

type AdminPermission = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

type AdminRole = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_system?: boolean;
  created_at?: string;
  updated_at?: string;
  permissions: AdminPermission[];
};

type AdminUser = {
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
  roles: AdminRole[];
  permissions: AdminPermission[];
};

type AuditEntry = {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor?: {
    id: string;
    full_name: string | null;
    email: string | null;
  } | null;
};

type AdminRbacPanelProps = {
  token: string;
  roleKeys: string[];
  permissions: string[];
  activeSection?: 'users' | 'roles' | 'permissions' | 'audit';
  showTabs?: boolean;
};

type UserFormState = {
  email: string;
  password: string;
  full_name: string;
  member_type: AdminUser['member_type'];
  institution: string;
  department: string;
};

type RoleFormState = {
  key: string;
  name: string;
  description: string;
  is_system: boolean;
};

type PermissionFormState = {
  key: string;
  name: string;
  description: string;
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'N/A';
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function getDraftRoleNames(roles: AdminRole[], selectedRoleKeys: string[]) {
  const names = roles.filter((role) => selectedRoleKeys.includes(role.key)).map((role) => role.name);
  return names.length > 0 ? names : ['Sin roles'];
}

async function maybeFetch<T>(enabled: boolean, path: string, token: string): Promise<T | null> {
  if (!enabled) {
    return null;
  }

  return apiFetch<T>(path, token);
}

export function AdminRbacPanel({
  token,
  roleKeys,
  permissions,
  activeSection,
  showTabs = true
}: AdminRbacPanelProps) {
  const permissionSet = new Set(permissions);
  const isAdmin = roleKeys.includes('ADMIN');
  const canReadUsers = isAdmin || permissionSet.has('users:read');
  const canCreateUsers = isAdmin || permissionSet.has('users:create');
  const canAssignRoles = isAdmin || permissionSet.has('users:assign_roles');
  const canManageRoles = isAdmin || permissionSet.has('roles:manage');
  const canManagePermissions = isAdmin || permissionSet.has('permissions:manage');
  const canReadAudit = isAdmin || permissionSet.has('audit:read');

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [availablePermissions, setAvailablePermissions] = useState<AdminPermission[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'roles' | 'permissions' | 'audit'>(activeSection ?? 'users');
  const [userRoleDrafts, setUserRoleDrafts] = useState<Record<string, string[]>>({});
  const [rolePermissionDrafts, setRolePermissionDrafts] = useState<Record<string, string[]>>({});

  const [userForm, setUserForm] = useState<UserFormState>({
    email: '',
    password: '',
    full_name: '',
    member_type: 'student',
    institution: '',
    department: ''
  });
  const [roleForm, setRoleForm] = useState<RoleFormState>({
    key: '',
    name: '',
    description: '',
    is_system: false
  });
  const [permissionForm, setPermissionForm] = useState<PermissionFormState>({
    key: '',
    name: '',
    description: ''
  });

  useEffect(() => {
    if (activeSection) {
      setActiveTab(activeSection);
    }
  }, [activeSection]);

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [usersResult, rolesResult, permissionsResult, auditResult] = await Promise.all([
          maybeFetch<{ items: AdminUser[] }>(canReadUsers, '/api/admin/users', token),
          maybeFetch<{ items: AdminRole[] }>(canManageRoles, '/api/admin/roles', token),
          maybeFetch<{ items: AdminPermission[] }>(canManagePermissions, '/api/admin/permissions', token),
          maybeFetch<{ items: AuditEntry[] }>(canReadAudit, '/api/admin/audit', token)
        ]);

        if (!active) return;

        const nextUsers = usersResult?.items ?? [];
        const nextRoles = rolesResult?.items ?? [];
        const nextPermissions = permissionsResult?.items ?? [];
        const nextAudit = auditResult?.items ?? [];

        setUsers(nextUsers);
        setRoles(nextRoles);
        setAvailablePermissions(nextPermissions);
        setAuditLogs(nextAudit);
        setUserRoleDrafts(
          Object.fromEntries(nextUsers.map((user) => [user.id, user.roles.map((role) => role.key)]))
        );
        setRolePermissionDrafts(
          Object.fromEntries(nextRoles.map((role) => [role.id, role.permissions.map((permission) => permission.key)]))
        );
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el panel RBAC');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      active = false;
    };
  }, [token, canReadUsers, canManageRoles, canManagePermissions, canReadAudit, refreshTick]);

  const refresh = () => setRefreshTick((value) => value + 1);

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreateUsers) return;

    setSubmitting('create-user');
    setError(null);
    setMessage(null);

    try {
      await apiFetch('/api/admin/users', token, {
        method: 'POST',
        body: JSON.stringify(userForm)
      });

      setUserForm({
        email: '',
        password: '',
        full_name: '',
        member_type: 'student',
        institution: '',
        department: ''
      });
      setMessage('Usuario creado correctamente.');
      refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'No se pudo crear el usuario');
    } finally {
      setSubmitting(null);
    }
  };

  const handleUserRoleToggle = (userId: string, roleKey: string) => {
    setUserRoleDrafts((current) => {
      const next = new Set(current[userId] ?? []);
      if (next.has(roleKey)) {
        next.delete(roleKey);
      } else {
        next.add(roleKey);
      }
      return { ...current, [userId]: unique([...next]) };
    });
  };

  const handleSaveUserRoles = async (userId: string) => {
    if (!canAssignRoles) return;

    const nextRoleKeys = userRoleDrafts[userId] ?? [];
    setSubmitting(`user-${userId}`);
    setError(null);
    setMessage(null);

    try {
      await apiFetch(`/api/admin/users/${userId}/roles`, token, {
        method: 'PATCH',
        body: JSON.stringify({ role_keys: nextRoleKeys })
      });
      setMessage('Roles de usuario actualizados.');
      refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudieron guardar los roles');
    } finally {
      setSubmitting(null);
    }
  };

  const handleCreateRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManageRoles) return;

    setSubmitting('create-role');
    setError(null);
    setMessage(null);

    try {
      await apiFetch('/api/admin/roles', token, {
        method: 'POST',
        body: JSON.stringify({
          key: roleForm.key,
          name: roleForm.name,
          description: roleForm.description || null,
          is_system: roleForm.is_system
        })
      });

      setRoleForm({
        key: '',
        name: '',
        description: '',
        is_system: false
      });
      setMessage('Rol creado correctamente.');
      refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'No se pudo crear el rol');
    } finally {
      setSubmitting(null);
    }
  };

  const handleRolePermissionToggle = (roleId: string, permissionKey: string) => {
    setRolePermissionDrafts((current) => {
      const next = new Set(current[roleId] ?? []);
      if (next.has(permissionKey)) {
        next.delete(permissionKey);
      } else {
        next.add(permissionKey);
      }
      return { ...current, [roleId]: unique([...next]) };
    });
  };

  const handleSaveRolePermissions = async (roleId: string) => {
    if (!canManagePermissions) return;

    const permissionKeys = rolePermissionDrafts[roleId] ?? [];
    setSubmitting(`role-${roleId}`);
    setError(null);
    setMessage(null);

    try {
      await apiFetch(`/api/admin/roles/${roleId}/permissions`, token, {
        method: 'PUT',
        body: JSON.stringify({ permission_keys: permissionKeys })
      });
      setMessage('Permisos del rol actualizados.');
      refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudieron guardar los permisos');
    } finally {
      setSubmitting(null);
    }
  };

  const handleCreatePermission = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManagePermissions) return;

    setSubmitting('create-permission');
    setError(null);
    setMessage(null);

    try {
      await apiFetch('/api/admin/permissions', token, {
        method: 'POST',
        body: JSON.stringify({
          key: permissionForm.key,
          name: permissionForm.name,
          description: permissionForm.description || null
        })
      });

      setPermissionForm({
        key: '',
        name: '',
        description: ''
      });
      setMessage('Permiso creado correctamente.');
      refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'No se pudo crear el permiso');
    } finally {
      setSubmitting(null);
    }
  };

  const canSeeAnyAdminTab = isAdmin || canReadUsers || canManageRoles || canManagePermissions || canReadAudit;

  return (
    <section className="admin-rbac">
      <div className="panel__header">
        <div>
          <span className="panel__eyebrow">RBAC</span>
          <h2>Administracion de usuarios, roles y permisos</h2>
        </div>
        {showTabs ? (
          <div className="admin-rbac__tabs">
            <button type="button" className={activeTab === 'users' ? 'is-active' : ''} onClick={() => setActiveTab('users')}>
              Usuarios
            </button>
            <button type="button" className={activeTab === 'roles' ? 'is-active' : ''} onClick={() => setActiveTab('roles')}>
              Roles
            </button>
            <button
              type="button"
              className={activeTab === 'permissions' ? 'is-active' : ''}
              onClick={() => setActiveTab('permissions')}
            >
              Permisos
            </button>
            <button type="button" className={activeTab === 'audit' ? 'is-active' : ''} onClick={() => setActiveTab('audit')}>
              Auditoria
            </button>
          </div>
        ) : null}
      </div>

      {loading ? <div className="empty-state">Cargando administracion RBAC...</div> : null}
      {error ? <div className="page-banner">{error}</div> : null}
      {message ? <div className="page-banner">{message}</div> : null}

      {!canSeeAnyAdminTab && !loading ? (
        <div className="empty-state">Tu perfil no tiene acceso a la administracion RBAC.</div>
      ) : null}

      {!loading && canSeeAnyAdminTab ? (
        <>
          {activeTab === 'users' ? (
            <div className="admin-rbac__layout admin-rbac__layout--stacked">
              <article className="panel editor-card admin-rbac__form-card">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Crear usuario</span>
                    <h3>Alta institucional</h3>
                  </div>
                  <span className="badge">Directorio</span>
                </div>

                {canCreateUsers ? (
                  <form className="auth-form crud-form crud-form--admin" onSubmit={handleCreateUser}>
                    <label>
                      Correo
                      <input
                        type="email"
                        value={userForm.email}
                        onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      Contrasena inicial
                      <input
                        type="password"
                        minLength={8}
                        value={userForm.password}
                        onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      Nombre completo
                      <input
                        type="text"
                        value={userForm.full_name}
                        onChange={(event) => setUserForm((current) => ({ ...current, full_name: event.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      Tipo de usuario
                      <select
                        value={userForm.member_type}
                        onChange={(event) =>
                          setUserForm((current) => ({
                            ...current,
                            member_type: event.target.value as AdminUser['member_type']
                          }))
                        }
                      >
                        <option value="student">Estudiante</option>
                        <option value="teacher">Docente</option>
                        <option value="researcher">Investigador</option>
                        <option value="public">Publico</option>
                        <option value="staff">Personal</option>
                      </select>
                    </label>
                    <label>
                      Institucion
                      <input
                        type="text"
                        value={userForm.institution}
                        onChange={(event) => setUserForm((current) => ({ ...current, institution: event.target.value }))}
                      />
                    </label>
                    <label>
                      Departamento
                      <input
                        type="text"
                        value={userForm.department}
                        onChange={(event) => setUserForm((current) => ({ ...current, department: event.target.value }))}
                      />
                    </label>
                    <button type="submit" disabled={submitting === 'create-user'}>
                      {submitting === 'create-user' ? 'Creando...' : 'Crear usuario'}
                    </button>
                  </form>
                ) : (
                  <div className="empty-state">Solo un ADMIN puede crear usuarios.</div>
                )}
              </article>

              <article className="panel admin-rbac__content">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Usuarios</span>
                    <h3>Asignacion de roles</h3>
                  </div>
                  <span className="badge">{users.length} usuarios</span>
                </div>

                {!canReadUsers ? (
                  <div className="empty-state">No tienes permiso para ver usuarios.</div>
                ) : users.length === 0 ? (
                  <div className="empty-state">No hay usuarios para administrar.</div>
                ) : (
                  <div className="data-table-shell">
                    <table className="data-table data-table--roles">
                      <thead>
                        <tr>
                          <th>Usuario</th>
                          <th>Perfil</th>
                          <th>Roles actuales</th>
                          <th>Asignacion</th>
                          <th>Accion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => {
                          const draftRoles = userRoleDrafts[user.id] ?? user.roles.map((role) => role.key);

                          return (
                            <tr key={user.id}>
                              <td>
                                <div className="table-primary">
                                  <strong>{user.full_name}</strong>
                                  <span>{user.email}</span>
                                </div>
                              </td>
                              <td>
                                <div className="table-meta">
                                  <strong>{user.member_type}</strong>
                                  <span>{user.permissions.length} permisos efectivos</span>
                                </div>
                              </td>
                              <td>
                                <div className="badge-row badge-row--table">
                                  {getDraftRoleNames(roles, user.roles.map((role) => role.key)).map((roleName) => (
                                    <span key={`${user.id}-${roleName}`} className="badge">
                                      {roleName}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td>
                                {canAssignRoles ? (
                                  <div className="table-role-picker">
                                    {roles.map((role) => {
                                      const checked = draftRoles.includes(role.key);
                                      return (
                                        <label
                                          key={role.id}
                                          className={
                                            checked ? 'choice-card choice-card--inline is-selected' : 'choice-card choice-card--inline'
                                          }
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => handleUserRoleToggle(user.id, role.key)}
                                          />
                                          <span>
                                            <strong>{role.name}</strong>
                                            <small>{role.key}</small>
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="table-muted">Solo un ADMIN puede asignar roles.</div>
                                )}
                              </td>
                              <td>
                                <div className="table-actions">
                                  <small>{draftRoles.length} seleccionados</small>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveUserRoles(user.id)}
                                    disabled={!canAssignRoles || submitting === `user-${user.id}`}
                                  >
                                    {submitting === `user-${user.id}` ? 'Guardando...' : 'Guardar roles'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            </div>
          ) : null}

          {activeTab === 'roles' ? (
            <div className="admin-rbac__layout admin-rbac__layout--stacked">
              <article className="panel editor-card admin-rbac__form-card">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Crear rol</span>
                    <h3>Extension institucional</h3>
                  </div>
                  <span className="badge">Jerarquia</span>
                </div>

                {canManageRoles ? (
                  <form className="auth-form crud-form crud-form--admin" onSubmit={handleCreateRole}>
                    <label>
                      Clave
                      <input
                        type="text"
                        value={roleForm.key}
                        onChange={(event) => setRoleForm((current) => ({ ...current, key: event.target.value.toUpperCase() }))}
                        placeholder="AUXILIAR_BIBLIOTECA"
                        required
                      />
                    </label>
                    <label>
                      Nombre
                      <input
                        type="text"
                        value={roleForm.name}
                        onChange={(event) => setRoleForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Bibliotecario"
                        required
                      />
                    </label>
                    <label>
                      Descripcion
                      <textarea
                        rows={3}
                        value={roleForm.description}
                        onChange={(event) => setRoleForm((current) => ({ ...current, description: event.target.value }))}
                        placeholder="Permisos y alcance del rol"
                      />
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={roleForm.is_system}
                        onChange={(event) => setRoleForm((current) => ({ ...current, is_system: event.target.checked }))}
                      />
                      <span>Rol del sistema</span>
                    </label>
                    <button type="submit" disabled={submitting === 'create-role'}>
                      {submitting === 'create-role' ? 'Creando...' : 'Crear rol'}
                    </button>
                  </form>
                ) : (
                  <div className="empty-state">Solo un ADMIN puede crear roles.</div>
                )}
              </article>

              <article className="panel admin-rbac__content">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Roles</span>
                    <h3>Permisos por rol</h3>
                  </div>
                  <span className="badge">{roles.length} roles</span>
                </div>

                {!canManagePermissions ? (
                  <div className="empty-state">Solo un ADMIN puede modificar permisos.</div>
                ) : roles.length === 0 ? (
                  <div className="empty-state">No hay roles cargados.</div>
                ) : (
                  <div className="admin-list">
                    {roles.map((role) => {
                      const draftPermissions = rolePermissionDrafts[role.id] ?? role.permissions.map((permission) => permission.key);
                      return (
                        <article key={role.id} className="admin-row admin-row--stacked">
                          <div className="admin-row__header">
                            <div>
                              <strong>{role.name}</strong>
                              <p>{role.key}</p>
                            </div>
                            <div className="badge-row">
                              <span className="badge">{draftPermissions.length} permisos</span>
                              {role.is_system ? <span className="badge">Sistema</span> : null}
                            </div>
                          </div>

                          <div className="table-role-picker table-role-picker--permissions">
                            {availablePermissions.map((permission) => {
                              const checked = draftPermissions.includes(permission.key);
                              return (
                                <label
                                  key={permission.id}
                                  className={checked ? 'choice-card choice-card--inline is-selected' : 'choice-card choice-card--inline'}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => handleRolePermissionToggle(role.id, permission.key)}
                                  />
                                  <span>
                                    <strong>{permission.name}</strong>
                                    <small>{permission.key}</small>
                                  </span>
                                </label>
                              );
                            })}
                          </div>

                          <div className="admin-row__footer">
                            <small>{role.description || 'Sin descripcion'}</small>
                            <button
                              type="button"
                              onClick={() => handleSaveRolePermissions(role.id)}
                              disabled={submitting === `role-${role.id}`}
                            >
                              {submitting === `role-${role.id}` ? 'Guardando...' : 'Guardar permisos'}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </article>
            </div>
          ) : null}

          {activeTab === 'permissions' ? (
            <div className="admin-rbac__layout admin-rbac__layout--stacked">
              <article className="panel editor-card admin-rbac__form-card">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Crear permiso</span>
                    <h3>Acciones sensibles</h3>
                  </div>
                  <span className="badge">{availablePermissions.length} permisos</span>
                </div>

                {canManagePermissions ? (
                  <form className="auth-form crud-form crud-form--admin" onSubmit={handleCreatePermission}>
                    <label>
                      Clave
                      <input
                        type="text"
                        value={permissionForm.key}
                        onChange={(event) => setPermissionForm((current) => ({ ...current, key: event.target.value }))}
                        placeholder="books:create"
                        required
                      />
                    </label>
                    <label>
                      Nombre
                      <input
                        type="text"
                        value={permissionForm.name}
                        onChange={(event) => setPermissionForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Crear libros"
                        required
                      />
                    </label>
                    <label>
                      Descripcion
                      <textarea
                        rows={3}
                        value={permissionForm.description}
                        onChange={(event) => setPermissionForm((current) => ({ ...current, description: event.target.value }))}
                        placeholder="Permite registrar nuevos libros"
                      />
                    </label>
                    <button type="submit" disabled={submitting === 'create-permission'}>
                      {submitting === 'create-permission' ? 'Creando...' : 'Crear permiso'}
                    </button>
                  </form>
                ) : (
                  <div className="empty-state">Solo un ADMIN puede crear permisos.</div>
                )}
              </article>

              <article className="panel admin-rbac__content">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Permisos</span>
                    <h3>Catalogo vigente</h3>
                  </div>
                </div>

                {!canManagePermissions ? (
                  <div className="empty-state">Solo un ADMIN puede modificar permisos.</div>
                ) : availablePermissions.length === 0 ? (
                  <div className="empty-state">No hay permisos cargados.</div>
                ) : (
                  <div className="data-table-shell">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Nombre</th>
                          <th>Clave</th>
                          <th>Descripcion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {availablePermissions.map((permission) => (
                          <tr key={permission.id}>
                            <td><strong>{permission.name}</strong></td>
                            <td><code>{permission.key}</code></td>
                            <td>{permission.description || 'Sin descripcion'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            </div>
          ) : null}

          {activeTab === 'audit' ? (
            <div className="admin-rbac__layout admin-rbac__layout--stacked">
              <article className="panel admin-rbac__content">
                <div className="panel__header">
                  <div>
                    <span className="panel__eyebrow">Auditoria</span>
                    <h3>Acciones registradas</h3>
                  </div>
                  <span className="badge">{auditLogs.length} eventos</span>
                </div>

                {!canReadAudit ? (
                  <div className="empty-state">No tienes permiso para ver la auditoria.</div>
                ) : auditLogs.length === 0 ? (
                  <div className="empty-state">No hay eventos de auditoria aun.</div>
                ) : (
                  <div className="admin-list">
                    {auditLogs.map((entry) => (
                      <article key={entry.id} className="admin-row admin-row--stacked">
                        <div className="admin-row__header">
                          <div>
                            <strong>{entry.action}</strong>
                            <p>
                              {entry.actor?.full_name || entry.actor?.email || entry.actor_id || 'Sistema'} · {entry.entity_type}
                              {entry.entity_id ? ` · ${entry.entity_id}` : ''}
                            </p>
                          </div>
                          <small>{formatDate(entry.created_at)}</small>
                        </div>

                        {entry.metadata ? (
                          <pre className="audit-json">{JSON.stringify(entry.metadata, null, 2)}</pre>
                        ) : (
                          <div className="table-muted">Sin metadatos.</div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </article>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
