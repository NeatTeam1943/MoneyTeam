-- ============================================================================
--  Migration 55 — payment methods as a managed list.
--
--  Run after 54. Safe to re-run.
--
--  The methods were a constant in the form: cash, bank transfer, Bit, cheque,
--  credit card, Paybox. That is a guess about how parents pay, compiled into
--  the app — the next payment app launches and a mentor has to ask for a code
--  change to record it. Every other list the team maintains (vendors,
--  categories, priority levels, income sources) is a table they edit in
--  Settings, and this is no different.
--
--  The field on the form stays typeable either way: a method nobody added yet
--  can still be written in, so recording a payment is never blocked by the
--  list being incomplete. The list is a set of suggestions, not a gate.
-- ============================================================================

create table if not exists public.payment_methods (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- The order they appear in the picker. Same convention as priority_levels,
  -- so the most-used method can be put first instead of alphabetised.
  rank       int  not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- The list that was hard-coded, so nothing is lost on the way in. Matched by
-- name rather than inserted blindly, so re-running this file does not produce
-- six duplicates.
insert into public.payment_methods (name, rank)
select v.name, v.rank from (values
  ('מזומן', 10), ('העברה בנקאית', 20), ('ביט', 30),
  ('צ׳ק', 40), ('כרטיס אשראי', 50), ('פייבוקס', 60)
) as v(name, rank)
where not exists (select 1 from public.payment_methods p where p.name = v.name);

alter table public.payment_methods enable row level security;
alter table public.payment_methods force  row level security;

drop policy if exists payment_methods_read  on public.payment_methods;
drop policy if exists payment_methods_write on public.payment_methods;

-- Read by any member — a student recording a proposal picks from the same
-- list. Written by mentors, like every other configuration table.
create policy payment_methods_read on public.payment_methods
  for select using (public.member_role() is not null);
create policy payment_methods_write on public.payment_methods
  for all using (public.member_role() = 'mentor')
          with check (public.member_role() = 'mentor');

grant select, insert, update, delete on public.payment_methods to authenticated;

-- Belt and braces for migration 52's table.
--
-- Supabase grants new public tables to `authenticated` through default
-- privileges — `vendors` and `transaction_lines` carry no explicit grant and
-- have worked for a year, so this is not a live bug. But every other
-- new-table migration here (37, 41, 45) says it out loud rather than relying
-- on that, and 52 did not. This says it.
grant select, insert on public.shopping_change_notes to authenticated;

-- Verify:
--   select name, rank, is_active from public.payment_methods order by rank;
