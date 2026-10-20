move all. sql files into a dir-- ============================================================================
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

-- Belt and braces for migration 52's table — GUARDED, and the guard is the
-- important part.
--
-- Written as a bare `grant select, insert on public.shopping_change_notes`
-- this line raised "relation does not exist" on any database where migration
-- 52 had not been run. The Supabase SQL editor runs a whole file inside one
-- transaction, so that single failing line DISCARDED EVERYTHING ABOVE IT —
-- the table, the seed, the policies, the lot. The symptom was the API
-- reporting that payment_methods was not in its schema cache, which reads
-- like a caching problem and is nothing of the kind: the table was never
-- there, because a tidy-up line for an unrelated migration took the whole
-- file down with it.
--
-- A migration must not fail over something that is not its own job.
do $$
begin
  if to_regclass('public.shopping_change_notes') is not null then
    grant select, insert on public.shopping_change_notes to authenticated;
  end if;
end $$;

-- Tell the API about the new table.
--
-- PostgREST serves from a cached copy of the schema, so a table created while
-- it is running does not exist as far as the REST API is concerned — the
-- client gets "Could not find the table 'public.payment_methods' in the schema
-- cache" even though the SQL ran perfectly. Supabase usually reloads it on its
-- own through an event trigger, but not always and not instantly. This asks
-- for it explicitly, so the table is usable the moment this file finishes.
notify pgrst, 'reload schema';

-- Verify:
--   select name, is_active from public.payment_methods order by name;
--   -- if the API still says the table is missing, run just this line again:
--   notify pgrst, 'reload schema';
