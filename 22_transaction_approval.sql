-- ============================================================================
--  Migration 22 — proposed transactions, pending mentor approval.
--
--  A student can record an expense or income; it does nothing to the books
--  until a mentor approves it. Same shape as shopping_items, which has worked
--  this way since migration 01.
--
--  THE RULE THAT MATTERS
--  A pending transaction must not appear in ANY money figure — not a balance,
--  not a budget's used amount, not a report total, not an export — while
--  staying plainly visible so it is not forgotten. Anything that forgets to
--  filter will quietly inflate a number, and a number that is slightly too big
--  is the hardest kind of wrong to notice.
--
--  So the filtering is enforced where it cannot be forgotten: the balance view
--  excludes pending in SQL, and the app's aggregations are covered by fixtures
--  in scripts/golden-master-*.mjs that include a pending row on purpose. Any
--  surface that stops filtering fails the check.
--
--  Run after 21. Re-runnable.
-- ============================================================================

do $$ begin
  create type approval_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- Existing rows are history and are approved by definition. New rows default
-- to approved too, so a mentor entering a purchase is not slowed down; the
-- student path sets 'pending' explicitly.
alter table public.transactions
  add column if not exists approval approval_status not null default 'approved',
  add column if not exists proposed_by uuid references auth.users(id) on delete set null,
  add column if not exists decided_by  uuid references auth.users(id) on delete set null,
  add column if not exists decided_at  timestamptz,
  add column if not exists decision_note text;

create index if not exists ix_tx_approval on public.transactions(approval);

-- ---------------------------------------------------------------- guards ----
-- Only a mentor decides. A student may create a proposal and may edit their
-- own while it is still pending, but cannot approve anything — including their
-- own request.
create or replace function public.guard_transaction_approval()
returns trigger
language plpgsql
as $$
declare
  v_role text := coalesce(public.member_role()::text, '');
begin
  if tg_op = 'INSERT' then
    if v_role <> 'mentor' and new.approval <> 'pending' then
      raise exception 'Only a mentor can record an approved transaction directly';
    end if;
    if new.approval = 'pending' then
      new.proposed_by := coalesce(new.proposed_by, auth.uid());
    end if;
    return new;
  end if;

  if new.approval is distinct from old.approval then
    if v_role <> 'mentor' then
      raise exception 'Only a mentor can approve or reject a transaction';
    end if;
    new.decided_by := auth.uid();
    new.decided_at := now();
  elsif old.approval = 'approved' and v_role <> 'mentor' then
    raise exception 'Only a mentor can change an approved transaction';
  end if;

  return new;
end $$;

drop trigger if exists trg_transaction_approval on public.transactions;
create trigger trg_transaction_approval
  before insert or update on public.transactions
  for each row execute function public.guard_transaction_approval();

-- -------------------------------------------------------------- balances ----
-- Money that has not been approved has not moved. Both balance views are
-- rebuilt to say so in SQL, where no screen can forget it.
drop view if exists public.account_balances;
create view public.account_balances as
select
  a.id, a.name, a.type, a.currency,
  a.opening_balance
    + coalesce(sum(t.amount) filter (where t.type = 'income'   and t.account_id    = a.id), 0)
    - coalesce(sum(t.amount) filter (where t.type = 'expense'  and t.account_id    = a.id), 0)
    - coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.account_id    = a.id), 0)
    + coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.to_account_id = a.id), 0)
    as balance
from public.accounts a
left join public.transactions t
  on (t.account_id = a.id or t.to_account_id = a.id)
 and t.approval = 'approved'
group by a.id, a.name, a.type, a.currency, a.opening_balance;

grant select on public.account_balances to authenticated;

drop view if exists public.account_balances_guest;
create view public.account_balances_guest as
select
  a.id, a.name, a.type, a.currency,
  a.opening_balance
    + coalesce(sum(t.amount) filter (where t.type = 'income'   and t.account_id    = a.id), 0)
    - coalesce(sum(t.amount) filter (where t.type = 'expense'  and t.account_id    = a.id), 0)
    - coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.account_id    = a.id), 0)
    + coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.to_account_id = a.id), 0)
    as balance
from public.accounts a
left join public.transactions t
  on (t.account_id = a.id or t.to_account_id = a.id)
 and t.approval = 'approved'
where public.can_view_public()
group by a.id, a.name, a.type, a.currency, a.opening_balance;

grant select on public.account_balances_guest to authenticated, anon;

-- Parents see the ledger; a proposal is not the ledger.
drop view if exists public.transactions_guest;
create view public.transactions_guest as
select
  t.id, t.season_id, t.date, t.type, t.amount, t.currency,
  t.account_id, t.to_account_id, t.income_source_id, t.category_id,
  t.budget_id, t.vendor, t.description,
  t.receipt_no, t.receipt_number, t.team_scope,
  t.fx_currency, t.fx_amount, t.fx_rate
from public.transactions t
where public.can_view_public()
  and t.approval = 'approved';

grant select on public.transactions_guest to authenticated, anon;

-- ------------------------------------------------------------ proposing ----
-- save_expense gains the flag. Anyone who is not a mentor gets 'pending'
-- regardless of what the client asks for — the decision is not the client's
-- to make.
drop function if exists public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text,text);

create or replace function public.save_expense(
  p_tx_id        uuid,
  p_season_id    uuid,
  p_date         date,
  p_account_id   uuid,
  p_vendor       text,
  p_description  text,
  p_receipt_url  text,
  p_lines        jsonb,
  p_payer_name   text default null,
  p_team_scope   text default null,
  p_propose      boolean default false
) returns uuid
language plpgsql
as $$
declare
  v_id      uuid;
  v_total   numeric(12,2);
  v_line    jsonb;
  v_scope   team_scope;
  v_scopes  int;
  v_one     text;
  v_curs    int;
  v_hdr_cur text;
  v_hdr_amt numeric(12,2);
  v_hdr_rt  numeric(12,6);
  v_cat     uuid;
  v_appr    approval_status;
begin
  select coalesce(sum((l->>'amount')::numeric), 0)
    into v_total from jsonb_array_elements(p_lines) l;
  if v_total <= 0 then
    raise exception 'An expense needs at least one line with a positive amount';
  end if;

  v_appr := case
    when p_propose or coalesce(public.member_role()::text, '') <> 'mentor'
      then 'pending'::approval_status
    else 'approved'::approval_status
  end;

  select count(distinct coalesce(nullif(l->>'team_scope',''), 'both')),
         min(coalesce(nullif(l->>'team_scope',''), 'both'))
    into v_scopes, v_one
    from jsonb_array_elements(p_lines) l;

  v_scope := coalesce(
    nullif(p_team_scope, '')::team_scope,
    case when v_scopes = 1 then v_one::team_scope else 'both'::team_scope end);

  select count(distinct l->>'fx_currency')
    into v_curs
    from jsonb_array_elements(p_lines) l
   where nullif(l->>'fx_currency','') is not null;

  if v_curs = 1 then
    select nullif(l->>'fx_currency',''),
           sum((l->>'fx_amount')::numeric),
           max((l->>'fx_rate')::numeric)
      into v_hdr_cur, v_hdr_amt, v_hdr_rt
      from jsonb_array_elements(p_lines) l
     where nullif(l->>'fx_currency','') is not null
     group by 1;
  end if;

  if p_tx_id is null then
    insert into public.transactions
      (season_id, type, date, amount, account_id, vendor, description, receipt_url,
       payer_name, team_scope, fx_currency, fx_amount, fx_rate, approval)
    values
      (p_season_id, 'expense', p_date, v_total, p_account_id, p_vendor, p_description, p_receipt_url,
       p_payer_name, v_scope, v_hdr_cur, v_hdr_amt, v_hdr_rt, v_appr)
    returning id into v_id;
  else
    update public.transactions set
      date=p_date, amount=v_total, account_id=p_account_id,
      vendor=p_vendor, description=p_description, receipt_url=p_receipt_url,
      payer_name=p_payer_name, team_scope=v_scope,
      fx_currency=v_hdr_cur, fx_amount=v_hdr_amt, fx_rate=v_hdr_rt
      where id=p_tx_id;
    v_id := p_tx_id;
    delete from public.transaction_lines where transaction_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_cat := nullif(v_line->>'category_id','')::uuid;
    if v_cat is null and nullif(v_line->>'budget_id','') is not null then
      select category_id into v_cat from public.budgets
       where id = (v_line->>'budget_id')::uuid;
    end if;

    insert into public.transaction_lines
      (transaction_id, budget_id, amount, shopping_item_id, description,
       fx_currency, fx_amount, fx_rate, team_scope, category_id)
    values (
      v_id,
      nullif(v_line->>'budget_id','')::uuid,
      (v_line->>'amount')::numeric,
      nullif(v_line->>'shopping_item_id','')::uuid,
      nullif(v_line->>'description',''),
      nullif(v_line->>'fx_currency',''),
      nullif(v_line->>'fx_amount','')::numeric,
      nullif(v_line->>'fx_rate','')::numeric,
      coalesce(nullif(v_line->>'team_scope',''), 'both')::team_scope,
      v_cat
    );
    -- A proposal must not move a shopping item to "ordered"; nothing has been
    -- bought until a mentor says so.
    if nullif(v_line->>'shopping_item_id','') is not null and v_appr = 'approved' then
      update public.shopping_items
        set status='ordered', transaction_id=v_id
        where id = (v_line->>'shopping_item_id')::uuid;
    end if;
  end loop;

  return v_id;
end $$;

revoke all on function public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text,text,boolean) from public;
grant execute on function public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text,text,boolean) to authenticated;

-- --------------------------------------------------------------- decide ----
create or replace function public.decide_transaction(
  p_tx_id uuid,
  p_approve boolean,
  p_note text default null
) returns void
language plpgsql
as $$
begin
  if coalesce(public.member_role()::text, '') <> 'mentor' then
    raise exception 'Only a mentor can decide a transaction';
  end if;

  update public.transactions
     set approval = case when p_approve then 'approved' else 'rejected' end::approval_status,
         decision_note = p_note
   where id = p_tx_id
     and approval = 'pending';

  -- Approving a purchase finally moves its linked shopping items along.
  if p_approve then
    update public.shopping_items s
       set status = 'ordered', transaction_id = p_tx_id
      from public.transaction_lines l
     where l.transaction_id = p_tx_id
       and l.shopping_item_id = s.id;
  end if;
end $$;

revoke all on function public.decide_transaction(uuid,boolean,text) from public;
grant execute on function public.decide_transaction(uuid,boolean,text) to authenticated;
