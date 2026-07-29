-- ============================================================================
--  Migration 21 — an expense line gets its own category.
--
--  THE PROBLEM
--  transaction_lines has no category. A line's category is inferred from the
--  budget it was charged to, which means you can only report at the
--  granularity you budget at. Want to know what was spent on motors? You must
--  first create a budget called motors — even if you have no intention of
--  planning at that level.
--
--  That is why the category tree grew "מנועי FRC", "אלקטרוניקה FRC" and the
--  rest. They are not categories anyone wanted to budget; they exist so the
--  spending would show up under a useful name. The category explosion is a
--  symptom of this missing column.
--
--  Note that shopping_items has had category_id all along, which is exactly
--  why the shopping list can be organised freely while the ledger cannot.
--
--  THE CHANGE
--  A line now records what it was FOR, independently of which pot paid for it.
--  Three separate concerns, three separate fields:
--
--     budget_id    which pot paid          (planning — as coarse as you like)
--     category_id  what it was for         (reporting — as fine as you like)
--     team_scope   which program           (already there since migration 17)
--
--  Budget once at "רובוט" and still ask "how much on FTC motors this season".
--
--  Backfill takes each line's category from its budget, so every existing
--  report reproduces exactly what it shows today — verified against the
--  production dump before shipping.
--
--  Run after 20. Re-runnable.
-- ============================================================================

alter table public.transaction_lines
  add column if not exists category_id uuid references public.categories(id) on delete set null;

create index if not exists ix_tx_lines_category on public.transaction_lines(category_id);

-- The cross-program guard from migration 20 fires on ANY update, so a
-- backfill that touches only category_id was rejected by rows that predate
-- the guard. Narrow it to what it was actually written to prevent: a change
-- to the pairing itself. Legacy rows can now be corrected in place instead of
-- being frozen out of every future migration.
create or replace function public.guard_line_budget_scope()
returns trigger
language plpgsql
as $$
declare
  v_budget team_scope;
begin
  if new.budget_id is null then
    return new;
  end if;

  -- On UPDATE, only re-check when the pairing changed.
  if tg_op = 'UPDATE'
     and new.budget_id is not distinct from old.budget_id
     and new.team_scope is not distinct from old.team_scope then
    return new;
  end if;

  select team_scope into v_budget from public.budgets where id = new.budget_id;

  if v_budget is not null
     and v_budget <> 'both'
     and new.team_scope <> 'both'
     and v_budget <> new.team_scope then
    raise exception
      'Cannot charge a % line to a % budget — they belong to different programs',
      new.team_scope, v_budget;
  end if;

  return new;
end $$;

-- Lossless backfill: what the line reports as today is what its budget's
-- category says, so start from exactly that.
update public.transaction_lines l
   set category_id = b.category_id
  from public.budgets b
 where b.id = l.budget_id
   and l.category_id is null
   and b.category_id is not null;

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
  p_team_scope   text default null
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
begin
  select coalesce(sum((l->>'amount')::numeric), 0)
    into v_total from jsonb_array_elements(p_lines) l;
  if v_total <= 0 then
    raise exception 'An expense needs at least one line with a positive amount';
  end if;

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
       payer_name, team_scope, fx_currency, fx_amount, fx_rate)
    values
      (p_season_id, 'expense', p_date, v_total, p_account_id, p_vendor, p_description, p_receipt_url,
       p_payer_name, v_scope, v_hdr_cur, v_hdr_amt, v_hdr_rt)
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
    -- An explicit category wins. Otherwise fall back to the paying budget's
    -- category, which keeps existing behaviour for anything that does not set
    -- one — nothing has to change all at once.
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
    if nullif(v_line->>'shopping_item_id','') is not null then
      update public.shopping_items
        set status='ordered', transaction_id=v_id
        where id = (v_line->>'shopping_item_id')::uuid;
    end if;
  end loop;

  return v_id;
end $$;

revoke all on function public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text,text) from public;
grant execute on function public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text,text) to authenticated;
