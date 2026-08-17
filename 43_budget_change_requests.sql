-- ============================================================================
--  Migration 43 — a request CHANGES a budget; it does not only raise it.
--
--  Migration 40 refused any amount at or below the current one. That was wrong
--  in the one situation the request path exists for: while budgets are locked,
--  an amount that turns out too HIGH has no route at all. The over-allocated
--  money stays committed, distorts "remaining", and freeing it for another
--  category means unlocking for everyone.
--
--  Raising and lowering are the same act — a decision to move a ceiling, with a
--  reason attached. Only the direction differs, and the direction is already
--  visible from amount_before and amount_after.
--
--  Equal amounts are still refused: a request that changes nothing is a
--  mistake, not a decision.
--
--  Re-runnable.
-- ============================================================================

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
    raise exception 'Not allowed to request a budget change';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required';
  end if;
  if p_new_amount is null or p_new_amount <= 0 then
    raise exception 'An amount above zero is required';
  end if;

  select amount, season_id into v_before, v_season
    from public.budgets where id = p_budget_id;
  if v_before is null then
    raise exception 'No such budget';
  end if;

  -- Either direction is a real decision. Only "no change" is refused.
  if p_new_amount = v_before then
    raise exception 'That is the current amount';
  end if;

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

-- The name stays request_budget_raise so nothing already deployed breaks; only
-- the rule inside it changed. A rename would mean the app and the database
-- disagreeing for the length of a deploy, which is a worse trade than a name
-- that is now slightly narrow.
comment on function public.request_budget_raise(uuid, numeric, text) is
  'Request a change to a budget amount, up or down. Named "raise" for
   compatibility; either direction is accepted. Mentors are auto-approved.';
