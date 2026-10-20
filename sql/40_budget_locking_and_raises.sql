-- ============================================================================
--  Migration 40 — budget locking, and requests to raise a budget.
--
--  TWO THINGS THAT ARE NOT THE SAME, and the app must not blur them:
--
--    A RAISE is a decision. The first estimate was wrong, or there is more
--    money to allocate and this is where it should go. It changes the ceiling.
--
--    AN OVERSPEND is a fact. More was spent than was allocated. Nothing here
--    blocks it, and raising the budget afterwards does NOT make it go away —
--    the overspend still happened and the reports still say so.
--
--  So a raise request is never offered as the "fix" for an overspend, and a
--  budget being over does not block a raise: the two are independent, and the
--  form says which one you are doing.
--
--  LOCKING is per season and stops the AMOUNT being edited. Nothing else.
--
--    still works while locked:  adding expenses, charging a locked budget,
--                               utilisation and overspend updating, viewing,
--                               the simulation, every report
--    stopped while locked:      changing a budget's amount, adding or deleting
--                               a budget
--
--  "We have decided the budget" is not "no more spending" — it is the point at
--  which the budget starts doing its job. The trigger below is therefore on
--  `budgets` ALONE; spending writes to transactions and transaction_lines and
--  never consults this flag. Utilisation is derived from those lines, so it
--  keeps moving with or without a lock.
--
--  Mentors lock and unlock; while unlocked, anyone who could edit before can
--  edit again.
--
--  Re-runnable.
-- ============================================================================

alter table public.seasons
  add column if not exists budgets_locked boolean not null default false,
  add column if not exists budgets_locked_at timestamptz,
  add column if not exists budgets_locked_by uuid references public.members(id) on delete set null;

comment on column public.seasons.budgets_locked is
  'When true, budget AMOUNTS in this season cannot be edited directly. Viewing, spending and reporting are unaffected.';

-- ---------------------------------------------------------------- requests ---
-- Every request is kept, decided or not. An approved one is the record of WHY
-- a ceiling moved — without it a budget silently grows and nobody can say who
-- asked, for what reason, or when.
create table if not exists public.budget_raise_requests (
  id             uuid primary key default gen_random_uuid(),
  budget_id      uuid not null references public.budgets(id) on delete cascade,
  season_id      uuid references public.seasons(id) on delete set null,

  amount_before  numeric(12,2) not null,
  amount_after   numeric(12,2) not null check (amount_after > 0),
  reason         text not null,

  status         approval_status not null default 'pending',
  requested_by   uuid references public.members(id) on delete set null,
  requested_at   timestamptz not null default now(),
  decided_by     uuid references public.members(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,

  -- Recorded at request time, not derived later: whether the budget was
  -- already over when this was asked for. It explains the request to whoever
  -- reads it in six months, and it is a fact about that moment.
  was_over       boolean not null default false,
  spent_at_request numeric(12,2)
);

create index if not exists ix_raise_budget on public.budget_raise_requests (budget_id);
create index if not exists ix_raise_pending on public.budget_raise_requests (status) where status = 'pending';

alter table public.budget_raise_requests enable row level security;
alter table public.budget_raise_requests force row level security;

drop policy if exists raises_read on public.budget_raise_requests;
create policy raises_read on public.budget_raise_requests for select
  using (public.member_role() is not null);

drop policy if exists raises_insert on public.budget_raise_requests;
create policy raises_insert on public.budget_raise_requests for insert
  with check (public.can_propose());

-- Only mentors decide. A requester withdrawing their own pending request is
-- handled by the RPC below rather than by an update policy, so the status
-- transitions stay in one place.
drop policy if exists raises_update on public.budget_raise_requests;
create policy raises_update on public.budget_raise_requests for update
  using (public.member_role() = 'mentor')
  with check (public.member_role() = 'mentor');

-- ------------------------------------------------------------------ lock ----
-- The lock is enforced here, not in the form. A rule the UI alone enforces is
-- not a rule.
create or replace function public.guard_budget_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked boolean;
begin
  select budgets_locked into v_locked
    from public.seasons where id = coalesce(new.season_id, old.season_id);

  if not coalesce(v_locked, false) then
    return new;
  end if;

  -- An approved raise is applying itself; the lock is not meant to stop that.
  if coalesce(current_setting('app.applying_budget_raise', true), 'off') = 'on' then
    return new;
  end if;

  -- Only the AMOUNT is frozen. Renaming, re-scoping or attaching working to a
  -- budget is not spending money and stays open.
  if tg_op = 'UPDATE' and new.amount is distinct from old.amount then
    raise exception 'Budgets are locked for this season. A mentor can unlock, or you can request a raise.';
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Budgets are locked for this season; a new budget cannot be added.';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Budgets are locked for this season.';
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists trg_guard_budget_lock on public.budgets;
create trigger trg_guard_budget_lock
  before insert or update or delete on public.budgets
  for each row execute function public.guard_budget_lock();

-- --------------------------------------------------------------- requests ---
-- Raising a budget. A mentor's request is approved on the spot; anyone else's
-- waits. Both leave the same record behind, so the log does not distinguish
-- between "a mentor did it" and "a mentor approved it" — in both cases a mentor
-- decided, and the reason is recorded either way.
create or replace function public.request_budget_raise(
  p_budget_id uuid,
  p_new_amount numeric,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_before  numeric(12,2);
  v_season  uuid;
  v_spent   numeric(12,2);
  v_mentor  boolean := coalesce(public.member_role()::text, '') = 'mentor';
begin
  if not public.can_propose() then
    raise exception 'Not allowed to request a budget raise';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required';
  end if;

  select amount, season_id into v_before, v_season
    from public.budgets where id = p_budget_id;
  if v_before is null then
    raise exception 'No such budget';
  end if;
  if p_new_amount <= v_before then
    raise exception 'A raise must be above the current amount';
  end if;

  -- What was already charged to this pot, for the record.
  select coalesce(sum(l.amount), 0) into v_spent
    from public.transaction_lines l
    join public.transactions t on t.id = l.transaction_id
   where l.budget_id = p_budget_id and t.approval = 'approved';

  insert into public.budget_raise_requests
    (budget_id, season_id, amount_before, amount_after, reason,
     status, requested_by, decided_by, decided_at,
     was_over, spent_at_request)
  values
    (p_budget_id, v_season, v_before, p_new_amount, btrim(p_reason),
     case when v_mentor then 'approved'::approval_status else 'pending'::approval_status end,
     auth.uid(),
     case when v_mentor then auth.uid() end,
     case when v_mentor then now() end,
     v_spent > v_before, v_spent)
  returning id into v_id;

  if v_mentor then
    perform public.apply_budget_raise(v_id);
  end if;

  return v_id;
end $$;

-- Applying an approved raise. Separate so approval is one step that cannot
-- half-happen: the amount moves and the request is marked in the same call.
create or replace function public.apply_budget_raise(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget uuid;
  v_after  numeric(12,2);
begin
  select budget_id, amount_after into v_budget, v_after
    from public.budget_raise_requests
   where id = p_request_id and status = 'approved';
  if v_budget is null then
    raise exception 'No approved request with that id';
  end if;

  -- A lock must not block an approved raise — the request path IS the
  -- sanctioned way to change a locked budget.
  --
  -- Signalled with a session setting rather than by disabling the trigger:
  -- `alter table ... disable trigger` takes an ACCESS EXCLUSIVE lock on the
  -- whole table and applies to every concurrent session, so for the duration of
  -- one approval nobody else could read or write budgets, and any write that
  -- slipped through would bypass the guard entirely.
  perform set_config('app.applying_budget_raise', 'on', true);  -- true = this transaction only
  update public.budgets set amount = v_after where id = v_budget;
  perform set_config('app.applying_budget_raise', 'off', true);
end $$;

create or replace function public.decide_budget_raise(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.member_role()::text, '') <> 'mentor' then
    raise exception 'Only a mentor can decide a budget raise';
  end if;

  update public.budget_raise_requests
     set status = case when p_approve then 'approved' else 'rejected' end::approval_status,
         decided_by = auth.uid(),
         decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request_id and status = 'pending';

  if not found then
    raise exception 'No pending request with that id';
  end if;

  if p_approve then
    perform public.apply_budget_raise(p_request_id);
  end if;
end $$;

revoke all on function public.request_budget_raise(uuid, numeric, text) from public;
revoke all on function public.decide_budget_raise(uuid, boolean, text) from public;
revoke all on function public.apply_budget_raise(uuid) from public;
grant execute on function public.request_budget_raise(uuid, numeric, text) to authenticated;
grant execute on function public.decide_budget_raise(uuid, boolean, text) to authenticated;

grant select, insert on public.budget_raise_requests to authenticated;
grant update on public.budget_raise_requests to authenticated;
