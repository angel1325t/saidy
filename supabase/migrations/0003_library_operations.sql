alter type public.material_type add value if not exists 'institutional_document';

alter table public.materials
  add column if not exists issn text,
  add column if not exists dewey_classification text,
  add column if not exists marc_record jsonb not null default '{}'::jsonb;

create index if not exists idx_materials_issn on public.materials (lower(issn));
create index if not exists idx_materials_dewey on public.materials (lower(dewey_classification));
