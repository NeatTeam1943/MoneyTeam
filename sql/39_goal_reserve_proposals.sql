-- ============================================================================
--  Migration 39 — students may edit goals, and PROPOSE a reservation.
--
--  Migration 37 let students create a goal but not edit it, which left the
--  person who typed a target unable to fix a typo in it. And reserving was
--  mentors-only outright, so a student who worked out that a goal needs ₪5,000
--  set aside had no way to say so.
--
--  Both are now the same pattern the ledger already uses for transactions: the
--  work is done by whoever noticed, and a mentor decides.
--
--    reserved            what is actually held. Only a mentor changes this.
--    reserved_proposed   what someone is asking to hold. Anyone who may
--                        propose can set it.
--
--  Two columns rather than a status flag on one, deliberately: every screen
--  that asks "how much is spoken for" must keep reading `reserved` and get the
--  approved figure. A single column with a pending state would make every one
--  of those reads decide which meaning it wanted, and the one that forgets
--  reports money as committed that nobody approved.
--
--  Re-runnable.
-- ============================================================================

alter table public.savings_goals
  add column if not exists reserved_proposed numeric(12,2)
    check (reserved_proposed is null or reserved_proposed >= 0),
  add column if not exists reserved_proposed_by uuid references public.members(id) on delete set null,
  add column if not exists reserved_proposed_at timestamptz,
  add column if not exists reserved_note text;

comment on column public.savings_goals.reserved_proposed is
  'A requested reservation awaiting a mentor. NULL means nothing pending. Never counts as committed money — only `reserved` does.';

-- Editing a goal: anyone who may propose.
drop policy if exists goals_update on public.savings_goals;
create policy goals_update
  on public.savings_goals for update
  using (public.can_propose())
  with check (public.can_propose());

-- `reserved` is the committed figure and stays a mentor decision. Guarded by a
-- trigger, not by hiding the input: a rule the UI alone enforces is not a rule,
-- and this one decides how much money the rest of the app calls spendable.
create or replace function public.guard_goal_reserved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mentor boolean := coalesce(public.member_role()::text, '') = 'mentor';
begin
  if tg_op = 'INSERT' then
    if coalesce(new.reserved, 0) <> 0 and not v_mentor then
      raise exception 'Only a mentor can reserve money; propose it instead';
    end if;
    if new.reserved_proposed is not null then
      new.reserved_proposed_by := auth.uid();
      new.reserved_proposed_at := now();
    end if;
    return new;
  end if;

  if new.reserved is distinct from old.reserved and not v_mentor then
    raise exception 'Only a mentor can change the reserved amount';
  end if;

  -- Stamp a new proposal, and clear the stamp when one is withdrawn or decided.
  if new.reserved_proposed is distinct from old.reserved_proposed then
    if new.reserved_proposed is null then
      new.reserved_proposed_by := null;
      new.reserved_proposed_at := null;
    else
      new.reserved_proposed_by := auth.uid();
      new.reserved_proposed_at := now();
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_goal_reserved on public.savings_goals;
drop trigger if exists trg_guard_goal_reserved_insert on public.savings_goals;
create trigger trg_guard_goal_reserved
  before insert or update on public.savings_goals
  for each row execute function public.guard_goal_reserved();

-- Deciding a proposal. A function rather than a policy exception, so approving
-- is one auditable step instead of "write reserved AND clear the proposal" done
-- correctly by every caller.
create or replace function public.decide_goal_reservation(
  p_goal_id uuid,
  p_approve boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(12,2);
begin
  if coalesce(public.member_role()::text, '') <> 'mentor' then
    raise exception 'Only a mentor can decide a reservation';
  end if;

  select reserved_proposed into v_amount
    from public.savings_goals where id = p_goal_id;
  if v_amount is null then
    raise exception 'That goal has no pending reservation';
  end if;

  update public.savings_goals
     set reserved = case when p_approve then v_amount else reserved end,
         reserved_proposed = null,
         reserved_proposed_by = null,
         reserved_proposed_at = null
   where id = p_goal_id;
end $$;

revoke all on function public.decide_goal_reservation(uuid, boolean) from public;
grant execute on function public.decide_goal_reservation(uuid, boolean) to authenticated;
