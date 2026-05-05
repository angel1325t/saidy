create extension if not exists pgcrypto;

create schema if not exists private;

do $$
begin
  create type public.app_role as enum ('admin', 'librarian', 'member');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.member_type as enum ('public', 'student', 'teacher', 'researcher', 'staff');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.material_type as enum ('physical_book', 'ebook', 'magazine', 'journal_article', 'thesis', 'audiobook', 'multimedia');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.copy_status as enum ('available', 'borrowed', 'reserved', 'lost', 'maintenance', 'archived');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.loan_status as enum ('active', 'returned', 'overdue', 'lost');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.reservation_status as enum ('queued', 'ready', 'cancelled', 'fulfilled', 'expired');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.fine_status as enum ('open', 'pending_payment', 'paid', 'waived');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.notification_channel as enum ('in_app', 'email', 'sms');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.notification_type as enum ('due_soon', 'reserved_available', 'fine_generated', 'acquisition_update', 'system');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.acquisition_status as enum ('requested', 'approved', 'ordered', 'received', 'cancelled');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.interlibrary_status as enum ('requested', 'approved', 'shipped', 'received', 'returned', 'cancelled');
exception
  when duplicate_object then null;
end $$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, private
as $$
declare
  metadata jsonb;
begin
  metadata := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  insert into public.profiles (
    id,
    email,
    full_name,
    role,
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
    coalesce((metadata ->> 'role')::public.app_role, 'member'),
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
    role = excluded.role,
    member_type = excluded.member_type,
    institution = excluded.institution,
    department = excluded.department,
    bio = excluded.bio,
    avatar_url = excluded.avatar_url,
    preferred_language = excluded.preferred_language,
    updated_at = now();

  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role public.app_role not null default 'member',
  member_type public.member_type not null default 'public',
  institution text,
  department text,
  bio text,
  avatar_url text,
  phone text,
  preferred_language text not null default 'es',
  loan_limit integer not null default 3,
  reservation_limit integer not null default 2,
  can_access_digital boolean not null default true,
  blocked_until timestamptz,
  fines_balance numeric(10,2) not null default 0,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public, private
as $$
  select role::text
  from public.profiles
  where id = auth.uid()
$$;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select private.current_profile_role() in ('admin', 'librarian')
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

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  kind public.material_type not null,
  title text not null,
  subtitle text,
  summary text,
  publisher text,
  publication_year integer,
  language text not null default 'es',
  isbn text,
  doi text,
  call_number text,
  keywords text[] not null default '{}'::text[],
  topics text[] not null default '{}'::text[],
  digital_url text,
  cover_url text,
  format_notes text,
  pages integer,
  edition text,
  volume text,
  status text not null default 'published',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_contributors (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  name text not null,
  role text not null default 'author',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.material_tags (
  material_id uuid not null references public.materials (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (material_id, tag_id)
);

create table if not exists public.material_relations (
  id uuid primary key default gen_random_uuid(),
  source_material_id uuid not null references public.materials (id) on delete cascade,
  target_material_id uuid not null references public.materials (id) on delete cascade,
  relation_type text not null,
  note text,
  created_at timestamptz not null default now(),
  unique (source_material_id, target_material_id, relation_type)
);

create table if not exists public.material_copies (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  barcode text unique,
  copy_code text unique,
  copy_type text not null default 'physical',
  status public.copy_status not null default 'available',
  location text,
  shelf_code text,
  acquired_at date,
  condition_note text,
  access_expires_at timestamptz,
  last_audited_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.digital_assets (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  provider text,
  asset_type text not null default 'ebook',
  access_url text not null,
  preview_url text,
  drm_policy text,
  available_from timestamptz,
  expires_at timestamptz,
  license_count integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  copy_id uuid references public.material_copies (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  processed_by uuid references public.profiles (id) on delete set null,
  loan_type text not null default 'physical',
  status public.loan_status not null default 'active',
  borrowed_at timestamptz not null default now(),
  due_at timestamptz not null,
  returned_at timestamptz,
  renewed_count integer not null default 0,
  renewable boolean not null default true,
  digital_access_until timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.reservation_status not null default 'queued',
  queue_position integer not null default 1,
  priority_score numeric(8,2) not null default 0,
  reserved_at timestamptz not null default now(),
  expires_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (material_id, user_id, status)
);

create table if not exists public.fines (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid references public.loans (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(10,2) not null,
  status public.fine_status not null default 'open',
  reason text,
  days_overdue integer not null default 0,
  currency text not null default 'BOB',
  issued_at timestamptz not null default now(),
  due_at timestamptz,
  paid_at timestamptz,
  waived_at timestamptz,
  payment_reference text,
  processed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  type public.notification_type not null default 'system',
  channel public.notification_channel not null default 'in_app',
  title text not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid references public.material_copies (id) on delete set null,
  material_id uuid references public.materials (id) on delete set null,
  location text,
  condition_status text not null default 'good',
  counted_at timestamptz not null default now(),
  is_missing boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.acquisition_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  kind public.material_type not null,
  justification text,
  supplier text,
  estimated_cost numeric(10,2),
  status public.acquisition_status not null default 'requested',
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  received_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.interlibrary_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles (id) on delete cascade,
  material_title text not null,
  external_library text,
  status public.interlibrary_status not null default 'requested',
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  returned_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null default current_date,
  period text not null default 'daily',
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (snapshot_date, period)
);

create index if not exists idx_materials_kind on public.materials (kind);
create index if not exists idx_materials_title on public.materials (lower(title));
create index if not exists idx_materials_year on public.materials (publication_year);
create index if not exists idx_tags_name on public.tags (lower(name));
create index if not exists idx_copies_material on public.material_copies (material_id);
create index if not exists idx_loans_user on public.loans (user_id);
create index if not exists idx_loans_status on public.loans (status);
create index if not exists idx_reservations_user on public.reservations (user_id);
create index if not exists idx_reservations_material on public.reservations (material_id);
create index if not exists idx_fines_user on public.fines (user_id);
create index if not exists idx_notifications_user on public.notifications (user_id);
create index if not exists idx_audit_logs_actor on public.audit_logs (actor_id);

drop trigger if exists handle_new_user_on_auth_users on auth.users;
create trigger handle_new_user_on_auth_users
  after insert on auth.users
  for each row execute function private.handle_new_user();

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

drop trigger if exists touch_materials_updated_at on public.materials;
create trigger touch_materials_updated_at
  before update on public.materials
  for each row execute function private.touch_updated_at();

drop trigger if exists touch_copies_updated_at on public.material_copies;
create trigger touch_copies_updated_at
  before update on public.material_copies
  for each row execute function private.touch_updated_at();

drop trigger if exists touch_assets_updated_at on public.digital_assets;
create trigger touch_assets_updated_at
  before update on public.digital_assets
  for each row execute function private.touch_updated_at();

drop trigger if exists touch_loans_updated_at on public.loans;
create trigger touch_loans_updated_at
  before update on public.loans
  for each row execute function private.touch_updated_at();

drop trigger if exists touch_reservations_updated_at on public.reservations;
create trigger touch_reservations_updated_at
  before update on public.reservations
  for each row execute function private.touch_updated_at();

drop trigger if exists touch_fines_updated_at on public.fines;
create trigger touch_fines_updated_at
  before update on public.fines
  for each row execute function private.touch_updated_at();

drop trigger if exists touch_notifications_updated_at on public.notifications;
create trigger touch_notifications_updated_at
  before update on public.notifications
  for each row execute function private.touch_updated_at();

drop trigger if exists touch_inventory_updated_at on public.inventory_items;
create trigger touch_inventory_updated_at
  before update on public.inventory_items
  for each row execute function private.touch_updated_at();

drop trigger if exists touch_acquisitions_updated_at on public.acquisition_requests;
create trigger touch_acquisitions_updated_at
  before update on public.acquisition_requests
  for each row execute function private.touch_updated_at();

drop trigger if exists touch_interlibrary_updated_at on public.interlibrary_requests;
create trigger touch_interlibrary_updated_at
  before update on public.interlibrary_requests
  for each row execute function private.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.tags enable row level security;
alter table public.materials enable row level security;
alter table public.material_contributors enable row level security;
alter table public.material_tags enable row level security;
alter table public.material_relations enable row level security;
alter table public.material_copies enable row level security;
alter table public.digital_assets enable row level security;
alter table public.loans enable row level security;
alter table public.reservations enable row level security;
alter table public.fines enable row level security;
alter table public.notifications enable row level security;
alter table public.inventory_items enable row level security;
alter table public.acquisition_requests enable row level security;
alter table public.interlibrary_requests enable row level security;
alter table public.audit_logs enable row level security;
alter table public.analytics_snapshots enable row level security;

create policy "Profiles can read themselves or staff"
  on public.profiles for select
  using (private.is_self_or_staff(id));

create policy "Profiles can update themselves or staff"
  on public.profiles for update
  using (private.is_self_or_staff(id))
  with check (private.is_self_or_staff(id));

create policy "Catalog is readable"
  on public.tags for select
  using (true);

create policy "Catalog materials are readable"
  on public.materials for select
  using (true);

create policy "Contributors are readable"
  on public.material_contributors for select
  using (true);

create policy "Material tags are readable"
  on public.material_tags for select
  using (true);

create policy "Material relations are readable"
  on public.material_relations for select
  using (true);

create policy "Copies are readable"
  on public.material_copies for select
  using (true);

create policy "Digital assets are readable"
  on public.digital_assets for select
  using (true);

create policy "Loans readable by self or staff"
  on public.loans for select
  using (private.is_self_or_staff(user_id));

create policy "Reservations readable by self or staff"
  on public.reservations for select
  using (private.is_self_or_staff(user_id));

create policy "Fines readable by self or staff"
  on public.fines for select
  using (private.is_self_or_staff(user_id));

create policy "Notifications readable by self or staff"
  on public.notifications for select
  using (private.is_self_or_staff(user_id));

create policy "Inventory readable by staff"
  on public.inventory_items for select
  using (private.is_staff());

create policy "Acquisition readable by staff"
  on public.acquisition_requests for select
  using (private.is_self_or_staff(requested_by));

create policy "Interlibrary readable by staff"
  on public.interlibrary_requests for select
  using (private.is_self_or_staff(requested_by));

create policy "Audit logs readable by staff"
  on public.audit_logs for select
  using (private.is_staff());

create policy "Analytics readable by staff"
  on public.analytics_snapshots for select
  using (private.is_staff());
