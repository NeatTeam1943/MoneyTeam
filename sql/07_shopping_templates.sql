-- ============================================================================
--  Migration 07 — mentor-defined shopping templates ("preset forms").
--  A template names a topic (e.g. "ברגים") and the fields students must fill
--  (length, size, ...). Run after 06.
-- ============================================================================

create table if not exists public.shopping_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- [{ "label": "אורך", "required": true }, { "label": "גודל", "required": false }]
  fields     jsonb not null default '[]'::jsonb,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.shopping_items
  add column if not exists template_id uuid references public.shopping_templates(id) on delete set null;
alter table public.shopping_items
  add column if not exists spec jsonb;   -- { "אורך": "20mm", "גודל": "M4" }

alter table public.shopping_templates enable row level security;
alter table public.shopping_templates force  row level security;
drop policy if exists templates_read  on public.shopping_templates;
drop policy if exists templates_write on public.shopping_templates;
create policy templates_read  on public.shopping_templates for select using (public.member_role() is not null);
create policy templates_write on public.shopping_templates for all
  using (public.member_role() = 'mentor') with check (public.member_role() = 'mentor');
