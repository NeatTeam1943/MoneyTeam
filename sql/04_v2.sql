-- ============================================================================
--  Migration 04 — v2: category hierarchy, budget roll-up, vendors,
--  student role, shopping-status control.  Run after 01, 02.
-- ============================================================================

-- 1) New enum values (must run outside a txn block; Supabase SQL editor is fine)
alter type member_role     add value if not exists 'student';
alter type shopping_status add value if not exists 'pending_approval';

-- 2) Category hierarchy
alter table public.categories
  add column if not exists parent_id uuid references public.categories(id) on delete set null;
create index if not exists ix_categories_parent on public.categories(parent_id);

-- 3) Vendors (managed option list for shopping)
create table if not exists public.vendors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- 4) Shopping items: category (drives budget roll-up), drop planned account use
alter table public.shopping_items
  add column if not exists category_id uuid references public.categories(id);
alter table public.shopping_items
  alter column status set default 'pending_approval';

-- 5) Only mentors may change a shopping item's status (enforced in the DB)
create or replace function public.guard_shopping_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.status is distinct from old.status)
     and coalesce(public.member_role()::text, '') <> 'mentor' then
    raise exception 'Only mentors can change the status of a shopping item';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_shopping_status on public.shopping_items;
create trigger trg_guard_shopping_status
  before update on public.shopping_items
  for each row execute function public.guard_shopping_status();

-- 6) Vendors RLS: read = any member, write = mentor
alter table public.vendors enable row level security;
alter table public.vendors force  row level security;
drop policy if exists vendors_read  on public.vendors;
drop policy if exists vendors_write on public.vendors;
create policy vendors_read  on public.vendors for select using (public.member_role() is not null);
create policy vendors_write on public.vendors for all
  using (public.member_role() = 'mentor') with check (public.member_role() = 'mentor');

-- 7) Re-scope policies for the mentor / student / viewer model
--    transactions: write = mentor only
drop policy if exists transactions_write on public.transactions;
create policy transactions_write on public.transactions for all
  using (public.member_role() = 'mentor') with check (public.member_role() = 'mentor');

--    budgets: write = mentor or student
drop policy if exists budgets_write on public.budgets;
create policy budgets_write on public.budgets for all
  using (public.member_role() in ('mentor','student'))
  with check (public.member_role() in ('mentor','student'));

--    shopping_items: split by command (student can add/edit, only mentor deletes;
--    status change guarded by trigger above)
drop policy if exists shopping_items_read   on public.shopping_items;
drop policy if exists shopping_items_write  on public.shopping_items;
drop policy if exists shopping_items_insert on public.shopping_items;
drop policy if exists shopping_items_update on public.shopping_items;
drop policy if exists shopping_items_delete on public.shopping_items;
create policy shopping_items_read   on public.shopping_items for select
  using (public.member_role() is not null);
create policy shopping_items_insert on public.shopping_items for insert
  with check (public.member_role() in ('mentor','student'));
create policy shopping_items_update on public.shopping_items for update
  using (public.member_role() in ('mentor','student'))
  with check (public.member_role() in ('mentor','student'));
create policy shopping_items_delete on public.shopping_items for delete
  using (public.member_role() = 'mentor');
