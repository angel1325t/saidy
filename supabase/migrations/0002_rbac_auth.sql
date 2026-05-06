create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create index if not exists idx_roles_key on public.roles (lower(key));
create index if not exists idx_permissions_key on public.permissions (lower(key));
create index if not exists idx_user_roles_user on public.user_roles (user_id);
create index if not exists idx_user_roles_role on public.user_roles (role_id);
create index if not exists idx_role_permissions_role on public.role_permissions (role_id);

create or replace function private.current_profile_roles()
returns text[]
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    array_agg(role_key order by priority, role_name),
    array[]::text[]
  )
  from (
    select distinct
      r.key as role_key,
      r.name as role_name,
      case r.key
        when 'ADMIN' then 1
        when 'BIBLIOTECARIO' then 2
        when 'DOCENTE' then 3
        when 'INVESTIGADOR' then 4
        when 'ESTUDIANTE' then 5
        else 99
      end as priority
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
  ) roles
$$;

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select role_key
  from (
    select distinct
      r.key as role_key,
      r.name as role_name,
      case r.key
        when 'ADMIN' then 1
        when 'BIBLIOTECARIO' then 2
        when 'DOCENTE' then 3
        when 'INVESTIGADOR' then 4
        when 'ESTUDIANTE' then 5
        else 99
      end as priority
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
  ) roles
  order by priority, role_name
  limit 1
$$;

create or replace function private.current_profile_permissions()
returns text[]
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    array_agg(permission_key order by permission_key),
    array[]::text[]
  )
  from (
    select distinct p.key as permission_key
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid()
  ) permissions
$$;

create or replace function private.has_role(role_key text)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.key = role_key
  )
$$;

create or replace function private.has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid()
      and p.key = permission_key
  )
$$;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.has_role('ADMIN') or private.has_role('BIBLIOTECARIO')
$$;

create or replace function private.is_self_or_staff(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select auth.uid() = target_id or private.is_staff()
$$;

create or replace function private.seed_rbac_defaults()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.roles (key, name, description, is_system)
  values
    ('ADMIN', 'ADMIN', 'Acceso total al sistema', true),
    ('BIBLIOTECARIO', 'BIBLIOTECARIO', 'Gestiona catálogo, circulación y reportes', true),
    ('DOCENTE', 'DOCENTE', 'Acceso institucional para personal docente', true),
    ('INVESTIGADOR', 'INVESTIGADOR', 'Acceso institucional para personal investigador', true),
    ('ESTUDIANTE', 'ESTUDIANTE', 'Acceso base para usuarios del sistema', true)
  on conflict (key) do update
  set
    name = excluded.name,
    description = excluded.description,
    is_system = excluded.is_system,
    updated_at = now();

  insert into public.permissions (key, name, description)
  values
    ('catalog:read', 'Leer catálogo', 'Consultar materiales y sus detalles'),
    ('catalog:create', 'Crear materiales', 'Registrar nuevos materiales en el catálogo'),
    ('catalog:update', 'Editar materiales', 'Modificar materiales existentes'),
    ('catalog:delete', 'Eliminar materiales', 'Eliminar materiales del catálogo'),
    ('circulation:read:own', 'Ver circulación propia', 'Consultar préstamos, reservas y multas propias'),
    ('circulation:read:any', 'Ver circulación general', 'Consultar cualquier préstamo, reserva o multa'),
    ('loans:create:physical', 'Crear préstamos físicos', 'Registrar préstamos físicos'),
    ('loans:create:digital', 'Crear préstamos digitales', 'Registrar préstamos digitales'),
    ('loans:renew:own', 'Renovar préstamos propios', 'Renovar préstamos del usuario autenticado'),
    ('loans:renew:any', 'Renovar cualquier préstamo', 'Renovar préstamos de cualquier usuario'),
    ('loans:return:own', 'Devolver préstamos propios', 'Cerrar préstamos del usuario autenticado'),
    ('loans:return:any', 'Devolver cualquier préstamo', 'Cerrar préstamos de cualquier usuario'),
    ('reservations:create', 'Crear reservas', 'Generar reservas sobre materiales'),
    ('reservations:read:own', 'Ver reservas propias', 'Consultar reservas del usuario autenticado'),
    ('reservations:read:any', 'Ver cualquier reserva', 'Consultar reservas de cualquier usuario'),
    ('reservations:cancel:own', 'Cancelar reservas propias', 'Cancelar reservas del usuario autenticado'),
    ('reservations:cancel:any', 'Cancelar cualquier reserva', 'Cancelar reservas de cualquier usuario'),
    ('fines:read:own', 'Ver multas propias', 'Consultar multas del usuario autenticado'),
    ('fines:read:any', 'Ver cualquier multa', 'Consultar multas de cualquier usuario'),
    ('fines:pay:any', 'Cobrar multas', 'Marcar multas como pagadas'),
    ('digital:access', 'Acceso digital', 'Abrir recursos digitales disponibles'),
    ('dashboard:view', 'Ver panel', 'Acceder al panel operativo y de analítica'),
    ('inventory:read', 'Ver inventario', 'Consultar inventario y auditorías'),
    ('inventory:manage', 'Gestionar inventario', 'Actualizar inventario y estado de copias'),
    ('reports:view', 'Ver reportes', 'Consultar adquisiciones, interlibrary y analítica'),
    ('notifications:manage', 'Gestionar notificaciones', 'Crear y administrar notificaciones'),
    ('audit:read', 'Ver auditoría', 'Consultar registros de auditoría'),
    ('users:read', 'Ver usuarios', 'Listar usuarios y sus roles'),
    ('users:create', 'Crear usuarios', 'Crear cuentas institucionales'),
    ('users:update', 'Editar usuarios', 'Modificar datos de usuario'),
    ('users:assign_roles', 'Asignar roles', 'Asignar o retirar roles a usuarios'),
    ('roles:manage', 'Gestionar roles', 'Crear o editar roles'),
    ('permissions:manage', 'Gestionar permisos', 'Crear o editar permisos')
  on conflict (key) do update
  set
    name = excluded.name,
    description = excluded.description,
    updated_at = now();

  insert into public.role_permissions (role_id, permission_id)
  select r.id, p.id
  from (
    values
      ('ADMIN', 'catalog:read'),
      ('ADMIN', 'catalog:create'),
      ('ADMIN', 'catalog:update'),
      ('ADMIN', 'catalog:delete'),
      ('ADMIN', 'circulation:read:own'),
      ('ADMIN', 'circulation:read:any'),
      ('ADMIN', 'loans:create:physical'),
      ('ADMIN', 'loans:create:digital'),
      ('ADMIN', 'loans:renew:own'),
      ('ADMIN', 'loans:renew:any'),
      ('ADMIN', 'loans:return:own'),
      ('ADMIN', 'loans:return:any'),
      ('ADMIN', 'reservations:create'),
      ('ADMIN', 'reservations:read:own'),
      ('ADMIN', 'reservations:read:any'),
      ('ADMIN', 'reservations:cancel:own'),
      ('ADMIN', 'reservations:cancel:any'),
      ('ADMIN', 'fines:read:own'),
      ('ADMIN', 'fines:read:any'),
      ('ADMIN', 'fines:pay:any'),
      ('ADMIN', 'digital:access'),
      ('ADMIN', 'dashboard:view'),
      ('ADMIN', 'inventory:read'),
      ('ADMIN', 'inventory:manage'),
      ('ADMIN', 'reports:view'),
      ('ADMIN', 'notifications:manage'),
      ('ADMIN', 'audit:read'),
      ('ADMIN', 'users:read'),
      ('ADMIN', 'users:create'),
      ('ADMIN', 'users:update'),
      ('ADMIN', 'users:assign_roles'),
      ('ADMIN', 'roles:manage'),
      ('ADMIN', 'permissions:manage'),
      ('BIBLIOTECARIO', 'catalog:read'),
      ('BIBLIOTECARIO', 'catalog:create'),
      ('BIBLIOTECARIO', 'catalog:update'),
      ('BIBLIOTECARIO', 'catalog:delete'),
      ('BIBLIOTECARIO', 'circulation:read:any'),
      ('BIBLIOTECARIO', 'loans:create:physical'),
      ('BIBLIOTECARIO', 'loans:create:digital'),
      ('BIBLIOTECARIO', 'loans:renew:any'),
      ('BIBLIOTECARIO', 'loans:return:any'),
      ('BIBLIOTECARIO', 'reservations:read:any'),
      ('BIBLIOTECARIO', 'reservations:cancel:any'),
      ('BIBLIOTECARIO', 'fines:read:any'),
      ('BIBLIOTECARIO', 'fines:pay:any'),
      ('BIBLIOTECARIO', 'digital:access'),
      ('BIBLIOTECARIO', 'dashboard:view'),
      ('BIBLIOTECARIO', 'inventory:read'),
      ('BIBLIOTECARIO', 'inventory:manage'),
      ('BIBLIOTECARIO', 'reports:view'),
      ('BIBLIOTECARIO', 'notifications:manage'),
      ('BIBLIOTECARIO', 'audit:read'),
      ('BIBLIOTECARIO', 'users:read'),
      ('DOCENTE', 'catalog:read'),
      ('DOCENTE', 'circulation:read:own'),
      ('DOCENTE', 'loans:renew:own'),
      ('DOCENTE', 'loans:return:own'),
      ('DOCENTE', 'reservations:create'),
      ('DOCENTE', 'reservations:read:own'),
      ('DOCENTE', 'reservations:cancel:own'),
      ('DOCENTE', 'fines:read:own'),
      ('DOCENTE', 'digital:access'),
      ('INVESTIGADOR', 'catalog:read'),
      ('INVESTIGADOR', 'circulation:read:own'),
      ('INVESTIGADOR', 'loans:renew:own'),
      ('INVESTIGADOR', 'loans:return:own'),
      ('INVESTIGADOR', 'reservations:create'),
      ('INVESTIGADOR', 'reservations:read:own'),
      ('INVESTIGADOR', 'reservations:cancel:own'),
      ('INVESTIGADOR', 'fines:read:own'),
      ('INVESTIGADOR', 'digital:access'),
      ('ESTUDIANTE', 'catalog:read'),
      ('ESTUDIANTE', 'circulation:read:own'),
      ('ESTUDIANTE', 'loans:renew:own'),
      ('ESTUDIANTE', 'loans:return:own'),
      ('ESTUDIANTE', 'reservations:create'),
      ('ESTUDIANTE', 'reservations:read:own'),
      ('ESTUDIANTE', 'reservations:cancel:own'),
      ('ESTUDIANTE', 'fines:read:own'),
      ('ESTUDIANTE', 'digital:access')
  ) as mapping(role_key, permission_key)
  join public.roles r on r.key = mapping.role_key
  join public.permissions p on p.key = mapping.permission_key
  on conflict do nothing;
end;
$$;

select private.seed_rbac_defaults();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, private
as $$
declare
  metadata jsonb;
  default_role_key text;
begin
  perform pg_advisory_xact_lock(hashtext('saidy-rbac-bootstrap')::bigint);

  metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  insert into public.profiles (
    id,
    email,
    full_name,
    member_type,
    institution,
    department,
    bio,
    avatar_url,
    preferred_language
  )
  values (
    new.id,
    new.email,
    coalesce(nullif(metadata ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    coalesce((metadata ->> 'member_type')::public.member_type, 'public'),
    nullif(metadata ->> 'institution', ''),
    nullif(metadata ->> 'department', ''),
    nullif(metadata ->> 'bio', ''),
    nullif(metadata ->> 'avatar_url', ''),
    coalesce(nullif(metadata ->> 'preferred_language', ''), 'es')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name,
    member_type = excluded.member_type,
    institution = excluded.institution,
    department = excluded.department,
    bio = excluded.bio,
    avatar_url = excluded.avatar_url,
    preferred_language = excluded.preferred_language,
    updated_at = now();

  if exists(select 1 from public.user_roles) then
    default_role_key := 'ESTUDIANTE';
  else
    default_role_key := 'ADMIN';
  end if;

  insert into public.user_roles (user_id, role_id)
  select new.id, r.id
  from public.roles r
  where r.key = default_role_key
  on conflict do nothing;

  return new;
end;
$$;

insert into public.user_roles (user_id, role_id)
select p.id,
  r.id
from public.profiles p
join public.roles r
  on r.key = case
    when p.role = 'admin' then 'ADMIN'
    when p.role = 'librarian' then 'BIBLIOTECARIO'
    when p.member_type = 'teacher' then 'DOCENTE'
    when p.member_type = 'researcher' then 'INVESTIGADOR'
    else 'ESTUDIANTE'
  end
on conflict do nothing;

alter table public.profiles drop column if exists role;

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;

drop policy if exists "Roles readable by admins" on public.roles;
create policy "Roles readable by admins"
  on public.roles for select
  using (private.has_permission('users:read') or private.has_permission('roles:manage'));

drop policy if exists "Permissions readable by admins" on public.permissions;
create policy "Permissions readable by admins"
  on public.permissions for select
  using (private.has_permission('permissions:manage') or private.has_permission('roles:manage'));

drop policy if exists "User roles readable by user or admins" on public.user_roles;
create policy "User roles readable by user or admins"
  on public.user_roles for select
  using (private.is_self_or_staff(user_id) or private.has_permission('users:read'));

drop policy if exists "Role permissions readable by admins" on public.role_permissions;
create policy "Role permissions readable by admins"
  on public.role_permissions for select
  using (private.has_permission('roles:manage') or private.has_permission('permissions:manage'));

drop trigger if exists touch_roles_updated_at on public.roles;
create trigger touch_roles_updated_at
  before update on public.roles
  for each row execute function private.touch_updated_at();

drop trigger if exists touch_permissions_updated_at on public.permissions;
create trigger touch_permissions_updated_at
  before update on public.permissions
  for each row execute function private.touch_updated_at();
