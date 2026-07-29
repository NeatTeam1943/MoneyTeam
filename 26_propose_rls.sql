-- ============================================================================
--  Migration 26 — let a proposal actually be saved.
--
--  Migration 22 built the whole proposal path: save_expense forces 'pending'
--  for a non-mentor, a trigger refuses anyone but a mentor approving, the
--  balances exclude pending. What it never did was open the door in RLS.
--
--  transactions_write and lines_write are both
--      with check (member_role() = 'mentor')
--  so a student pressing "הצע הוצאה" got
--      new row violates row-level security policy for table
--  after every other layer had already agreed the row was fine.
--
--  save_expense is SECURITY INVOKER, which is the right choice — it means RLS
--  is the wall rather than something the function has to re-implement. So the
--  wall needs a door, cut narrowly:
--
--    * a proposal may only be inserted as 'pending'
--    * it must be attributed to the person inserting it
--    * they may edit or withdraw it only while it is still pending, and only
--      their own
--
--  Everything else stays mentor-only. Approving remains impossible for them:
--  the trigger from 22 raises on any approval change by a non-mentor, and the
--  update policy below refuses to let approval move away from 'pending'.
--
--  Run after 22. Re-runnable.
-- ============================================================================

-- Who may propose at all. Kept as a function so the rule lives in one place
-- and reads the same in every policy below.
create or replace function public.can_propose()
returns boolean
language sql
stable
as $$
  select coalesce(public.member_role()::text, '') in ('mentor', 'editor', 'student');
$$;

revoke all on function public.can_propose() from public;
grant execute on function public.can_propose() to authenticated;

-- ---------------------------------------------------------- transactions ----
drop policy if exists transactions_propose_insert on public.transactions;
create policy transactions_propose_insert
  on public.transactions for insert
  with check (
    public.can_propose()
    and approval = 'pending'
    and coalesce(proposed_by, auth.uid()) = auth.uid()
  );

-- Editing your own proposal, while it is still awaiting a decision. The
-- approval column may not move: `using` pins the row's current state and
-- `with check` pins what it may become.
drop policy if exists transactions_propose_update on public.transactions;
create policy transactions_propose_update
  on public.transactions for update
  using (
    public.can_propose()
    and approval = 'pending'
    and proposed_by = auth.uid()
  )
  with check (
    approval = 'pending'
    and proposed_by = auth.uid()
  );

-- Withdrawing a request you have not had answered yet.
drop policy if exists transactions_propose_delete on public.transactions;
create policy transactions_propose_delete
  on public.transactions for delete
  using (
    public.can_propose()
    and approval = 'pending'
    and proposed_by = auth.uid()
  );

-- ------------------------------------------------------ transaction_lines ----
-- A line is only ever as permitted as its parent, so each policy asks the
-- parent rather than repeating the rule and risking the two drifting apart.
drop policy if exists lines_propose_insert on public.transaction_lines;
create policy lines_propose_insert
  on public.transaction_lines for insert
  with check (
    exists (
      select 1 from public.transactions t
       where t.id = transaction_id
         and t.approval = 'pending'
         and t.proposed_by = auth.uid()
    )
  );

drop policy if exists lines_propose_update on public.transaction_lines;
create policy lines_propose_update
  on public.transaction_lines for update
  using (
    exists (
      select 1 from public.transactions t
       where t.id = transaction_id
         and t.approval = 'pending'
         and t.proposed_by = auth.uid()
    )
  );

-- save_expense rewrites the lines on every edit, so deleting them has to be
-- possible for the same rows.
drop policy if exists lines_propose_delete on public.transaction_lines;
create policy lines_propose_delete
  on public.transaction_lines for delete
  using (
    exists (
      select 1 from public.transactions t
       where t.id = transaction_id
         and t.approval = 'pending'
         and t.proposed_by = auth.uid()
    )
  );

-- ---------------------------------------------------------------- reads ----
-- A proposer must be able to see their own request in the ledger. The existing
-- read policy already covers any member, so this only matters if that is ever
-- narrowed; stated explicitly so the intent survives.
drop policy if exists transactions_read_own_proposal on public.transactions;
create policy transactions_read_own_proposal
  on public.transactions for select
  using (proposed_by = auth.uid());
