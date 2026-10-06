-- ============================================================================
--  Migration 51 — the finance lead.
--
--  RUN 50 FIRST and let it finish. This file uses the enum value that 50 adds,
--  and Postgres refuses a new enum value inside the transaction that created
--  it ("unsafe use of new value").
--
--  A finance lead is a STUDENT with two extra powers, not a fourth role.
--
--  That is deliberate. Permissions in this schema are explicit whitelists —
--  there are 28 places across 11 migrations that read `in ('mentor','student')`
--  — not a hierarchy. A new member_role value would be a member of none of
--  them, so it would silently lose every right a student has: adding shopping
--  rows, editing budgets, proposing transactions, templates, goals. Each one
--  missed fails as a PostgREST 401, which this app renders as an empty screen
--  with no error anywhere. That is exactly how the guest budgets page stayed
--  broken through three rounds of looking in the wrong place.
--
--  A boolean leaves all 28 untouched and is read only where a NEW power is
--  granted: the status trigger and the delete policy below. It also composes —
--  a finance lead who is not a student (a parent volunteer, an alum) is just
--  the flag on a different role, with no schema change.
-- ============================================================================

-- 1) The flag ---------------------------------------------------------------
alter table public.members
  add column if not exists is_finance_lead boolean not null default false;

comment on column public.members.is_finance_lead is
  'Extra shopping-list powers on top of the row''s role: triage statuses and
   deleting other people''s unbought rows. Only mentors can set it — members
   is mentor-write-only (members_write, migration 01), and the name-setup
   screen writes to auth metadata rather than to this table, so there is no
   path for someone to set this on themselves.';

-- 2) The helper, mirroring member_role() ------------------------------------
--    SECURITY DEFINER so it can read `members` without tripping that table's
--    own RLS, which would otherwise recurse.
create or replace function public.is_finance_lead()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_finance_lead from public.members where id = auth.uid()), false);
$$;

revoke all on function public.is_finance_lead() from public;
grant execute on function public.is_finance_lead() to authenticated;

-- 3) Where a new request starts ---------------------------------------------
--    The form and the duplicate button both leave `status` out of the insert
--    precisely so this default is the single place that decides.
alter table public.shopping_items
  alter column status set default 'waiting_finance';

-- 4) Who may move a request, and to where -----------------------------------
--    Replaces the mentors-only guard from migration 04. The UI hides what a
--    person cannot do, but the UI is not the boundary: this app talks to
--    PostgREST directly, so anyone can send a PATCH by hand. This is the rule.
create or replace function public.guard_shopping_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Mentors decide; nothing here constrains them.
  if coalesce(public.member_role()::text, '') = 'mentor' then
    return new;
  end if;

  if public.is_finance_lead() then
    -- Triage only. 'approved', 'ordered' and 'received' are statements about
    -- money the team has committed, and they stay a mentor's to make.
    if new.status not in ('waiting_finance', 'waiting_sponsor', 'pending_approval', 'cancelled') then
      raise exception
        'A finance lead cannot set a shopping item to "%": approving, ordering and receiving are mentors only',
        new.status;
    end if;

    -- And only while the item is still in triage. Once a mentor has approved,
    -- ordered or received it, a finance lead cancelling it would be overruling
    -- that decision — including on a row that has already been paid for.
    if old.status in ('approved', 'ordered', 'received') then
      raise exception
        'This item was already approved by a mentor (status "%"); only a mentor can change it now',
        old.status;
    end if;

    return new;
  end if;

  raise exception 'Only a mentor or the finance lead can change the status of a shopping item';
end $$;

drop trigger if exists trg_guard_shopping_status on public.shopping_items;
create trigger trg_guard_shopping_status
  before update on public.shopping_items
  for each row execute function public.guard_shopping_status();

-- 5) Deleting -----------------------------------------------------------------
--    Replaces the policy from migration 48, adding the finance lead's clause.
--    They may clear out anyone's row, but the `transaction_id is null` guard
--    still applies to them: a row attached to a purchase is part of that
--    transaction's provenance, and deleting it orphans the line.
drop policy if exists shopping_items_delete on public.shopping_items;
create policy shopping_items_delete on public.shopping_items for delete
  using (
    public.member_role() = 'mentor'
    or (public.is_finance_lead() and transaction_id is null)
    or (created_by = auth.uid() and transaction_id is null)
  );

comment on policy shopping_items_delete on public.shopping_items is
  'Mentors may delete any row. A finance lead may delete anyone''s row that has
   not been bought. Everyone else may delete only their own, and only while it
   has not been bought.';

-- Verify:
--   select unnest(enum_range(null::shopping_status));          -- waiting_finance present
--   select column_default from information_schema.columns
--    where table_name = 'shopping_items' and column_name = 'status';
--   select email, role, is_finance_lead from public.members order by email;
