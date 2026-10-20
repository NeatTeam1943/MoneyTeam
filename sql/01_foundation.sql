-- ============================================================================
--  FRC Team Finance Platform — Foundation
--  Schema + Row Level Security + Auth roles + Receipts storage
--
--  Run ONCE in the Supabase SQL editor on a fresh project.
--  Safe to re-run: enums are guarded, tables use IF NOT EXISTS,
--  policies are dropped-then-created.
--
--  Auth model: mentor-provisioned. Turn OFF public signup in
--  Authentication > Providers > Email ("Allow new users to sign up").
--  Credentials live in Supabase's internal `auth` schema — never here.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Enumerated types
-- ---------------------------------------------------------------------------
do $$ begin
  create type member_role      as enum ('mentor', 'editor', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type account_type     as enum ('bank', 'school', 'store_credit', 'city', 'cash');
exception when duplicate_object then null; end $$;

do $$ begin
  create type income_source_type as enum ('sponsor', 'city', 'grant', 'fundraiser', 'dues', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type transaction_type as enum ('income', 'expense', 'transfer', 'in_kind');
exception when duplicate_object then null; end $$;

do $$ begin
  create type shopping_status  as enum ('wish', 'approved', 'ordered', 'received', 'cancelled');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- 2. updated_at helper trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;


-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

-- Team roster. id === the Supabase auth user id. This is the ONLY thing that
-- grants data access; a stray auth signup with no members row can touch nothing.
create table if not exists public.members (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        member_role not null default 'viewer',
  created_at  timestamptz not null default now()
);

-- Fiscal years / seasons. History = never deleted, just filtered by season_id.
create table if not exists public.seasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                 -- e.g. "2026 – REEFSCAPE"
  start_date  date,
  end_date    date,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Buckets where value sits. Bank, school-held, store credit, city fund, cash —
-- all one table. Store-credit balances fill from income (sponsor) OR transfer (bank).
create table if not exists public.accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  type            account_type not null,
  opening_balance numeric(12,2) not null default 0,
  currency        text not null default 'ILS',
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now()
);

-- Where income comes from. User-managed list (add sponsors without schema change).
create table if not exists public.income_sources (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        income_source_type not null default 'sponsor',
  contact     text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Expense / acquisition categories. User-managed.
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text,
  created_at  timestamptz not null default now()
);

-- Urgency levels YOU define (rank drives sort order, color drives the UI).
create table if not exists public.priority_levels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                 -- e.g. "Nice to have" … "Critical"
  rank        int  not null default 0,       -- lower = more urgent (or your call)
  color       text,
  created_at  timestamptz not null default now()
);

-- The ledger. Four types drive everything:
--   income   : value INTO account_id from income_source_id
--   expense  : value OUT of account_id (has receipt/קבלה)
--   transfer : account_id -> to_account_id (e.g. bank -> store credit)
--   in_kind  : sponsor bought us something. Touches NO cash account.
--              Counts as income-by-source AND acquisition-by-category.
create table if not exists public.transactions (
  id                uuid primary key default gen_random_uuid(),
  season_id         uuid not null references public.seasons(id),
  date              date not null default current_date,
  type              transaction_type not null,
  amount            numeric(12,2) not null check (amount > 0),  -- always positive; sign derived from type
  currency          text not null default 'ILS',
  account_id        uuid references public.accounts(id),        -- source (or the affected account)
  to_account_id     uuid references public.accounts(id),        -- transfers only
  income_source_id  uuid references public.income_sources(id),  -- income / in_kind
  category_id       uuid references public.categories(id),
  vendor            text,                                       -- where an expense was spent
  description       text,
  receipt_url       text,                                       -- קבלה (Supabase Storage path)
  receipt_number    text,
  notes             text,
  created_by        uuid references auth.users(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Type integrity: each type must have exactly the right fields set.
  constraint tx_type_shape check (
    case type
      when 'income'   then account_id is not null and to_account_id is null
                          and income_source_id is not null
      when 'expense'  then account_id is not null and to_account_id is null
      when 'transfer' then account_id is not null and to_account_id is not null
                          and account_id <> to_account_id and income_source_id is null
      when 'in_kind'  then account_id is null and to_account_id is null
                          and income_source_id is not null and category_id is not null
    end
  )
);

-- Wish list + shopping list. Links, מק״ט (sku), your urgency levels, and a
-- pointer back to the expense that fulfilled it once bought.
create table if not exists public.shopping_items (
  id                 uuid primary key default gen_random_uuid(),
  season_id          uuid not null references public.seasons(id),
  name               text not null,
  description        text,
  url                text,                                      -- link
  sku                text,                                      -- מק״ט
  vendor             text,
  est_price          numeric(12,2),
  quantity           int not null default 1,
  priority_level_id  uuid references public.priority_levels(id),
  status             shopping_status not null default 'wish',
  planned_account_id uuid references public.accounts(id),       -- how we intend to pay
  transaction_id     uuid references public.transactions(id),   -- set when actually bought
  notes              text,
  created_by         uuid references auth.users(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 4. Indexes (filters/sorts the table + graph views will hit constantly)
-- ---------------------------------------------------------------------------
create index if not exists ix_tx_season   on public.transactions(season_id);
create index if not exists ix_tx_date     on public.transactions(date);
create index if not exists ix_tx_type     on public.transactions(type);
create index if not exists ix_tx_account  on public.transactions(account_id);
create index if not exists ix_tx_to_acct  on public.transactions(to_account_id);
create index if not exists ix_tx_category on public.transactions(category_id);
create index if not exists ix_tx_source   on public.transactions(income_source_id);

create index if not exists ix_shop_season   on public.shopping_items(season_id);
create index if not exists ix_shop_status   on public.shopping_items(status);
create index if not exists ix_shop_priority on public.shopping_items(priority_level_id);

create trigger trg_tx_touch   before update on public.transactions
  for each row execute function public.touch_updated_at();
create trigger trg_shop_touch before update on public.shopping_items
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- 5. Role helper — SECURITY DEFINER so it can read `members` without tripping
--    that table's own RLS (avoids infinite recursion in the members policies).
-- ---------------------------------------------------------------------------
create or replace function public.member_role()
returns member_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.members where id = auth.uid();
$$;

revoke all on function public.member_role() from public;
grant execute on function public.member_role() to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Enable + FORCE RLS on every table
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'members','seasons','accounts','income_sources',
    'categories','priority_levels','transactions','shopping_items'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 7. Policies
--    read  : any member (role is not null)
--    config writes (accounts/seasons/sources/categories/levels/members): mentor
--    ledger writes (transactions/shopping_items): mentor + editor
-- ---------------------------------------------------------------------------

-- members: everyone on the team can see the roster; only mentors change it.
drop policy if exists members_read       on public.members;
drop policy if exists members_write      on public.members;
create policy members_read  on public.members
  for select using (public.member_role() is not null);
create policy members_write on public.members
  for all using (public.member_role() = 'mentor')
          with check (public.member_role() = 'mentor');

-- Config tables: read = any member, write = mentor only.
do $$
declare t text;
begin
  foreach t in array array['seasons','accounts','income_sources','categories','priority_levels'] loop
    execute format('drop policy if exists %I_read  on public.%I;', t, t);
    execute format('drop policy if exists %I_write on public.%I;', t, t);
    execute format($f$
      create policy %1$I_read on public.%1$I
        for select using (public.member_role() is not null);
    $f$, t);
    execute format($f$
      create policy %1$I_write on public.%1$I
        for all using (public.member_role() = 'mentor')
                with check (public.member_role() = 'mentor');
    $f$, t);
  end loop;
end $$;

-- Ledger tables: read = any member, write = mentor or editor.
do $$
declare t text;
begin
  foreach t in array array['transactions','shopping_items'] loop
    execute format('drop policy if exists %I_read  on public.%I;', t, t);
    execute format('drop policy if exists %I_write on public.%I;', t, t);
    execute format($f$
      create policy %1$I_read on public.%1$I
        for select using (public.member_role() is not null);
    $f$, t);
    execute format($f$
      create policy %1$I_write on public.%1$I
        for all using (public.member_role() in ('mentor','editor'))
                with check (public.member_role() in ('mentor','editor'));
    $f$, t);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- 8. Receipts storage bucket (private) + policies
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists receipts_read  on storage.objects;
drop policy if exists receipts_write on storage.objects;
create policy receipts_read on storage.objects
  for select using (bucket_id = 'receipts' and public.member_role() is not null);
create policy receipts_write on storage.objects
  for all using (bucket_id = 'receipts' and public.member_role() in ('mentor','editor'))
          with check (bucket_id = 'receipts' and public.member_role() in ('mentor','editor'));


-- ---------------------------------------------------------------------------
-- 9. Account balances view (all-time). Season-scoped nets are done in-app.
--    in_kind is intentionally excluded — it never touches a cash account.
--    security_invoker = the caller's RLS applies, not the view owner's.
-- ---------------------------------------------------------------------------
create or replace view public.account_balances
with (security_invoker = true) as
select
  a.id,
  a.name,
  a.type,
  a.currency,
  a.opening_balance
    + coalesce(sum(t.amount) filter (where t.type = 'income'   and t.account_id    = a.id), 0)
    - coalesce(sum(t.amount) filter (where t.type = 'expense'  and t.account_id    = a.id), 0)
    - coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.account_id    = a.id), 0)
    + coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.to_account_id = a.id), 0)
    as balance
from public.accounts a
left join public.transactions t
  on t.account_id = a.id or t.to_account_id = a.id
group by a.id, a.name, a.type, a.currency, a.opening_balance;


-- ============================================================================
--  BOOTSTRAP THE FIRST MENTOR (run separately, after the above succeeds)
--  ------------------------------------------------------------------------
--  1. Create the auth user: Authentication > Users > "Add user" (email + pw).
--  2. Copy that user's UID, then run the insert below (SQL editor runs as
--     postgres and bypasses RLS, so this first insert is allowed):
--
--     insert into public.members (id, email, full_name, role)
--     values ('PASTE-AUTH-UID-HERE', 'you@gmail.com', 'Your Name', 'mentor');
--
--  From then on you add editors/viewers the same way, or from the app.
-- ============================================================================
