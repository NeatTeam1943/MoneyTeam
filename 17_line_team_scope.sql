-- ============================================================================
--  Migration 17 — mark individual purchase LINES, not just whole purchases.
--
--  Migration 13 marked a transaction as a whole, which is wrong for the way
--  the team actually buys: one order from חנות ROBOT can contain an FTC field
--  part and an FRC swerve module on the same receipt. Marking the header
--  forces that purchase to be called "shared" and it then shows up under both
--  programs at full value.
--
--  Each line now carries its own marking. The header keeps its column and
--  keeps meaning "what this purchase is, overall" — it is derived from the
--  lines when they agree and left as 'both' when they do not, so every
--  existing screen that reads transactions.team_scope still works unchanged.
--
--  Run after 15 (it rebuilds the same save_expense). Re-runnable.
-- ============================================================================

alter table public.transaction_lines
  add column if not exists team_scope team_scope not null default 'both';

create index if not exists ix_tx_lines_team on public.transaction_lines(team_scope);

-- Backfill: existing lines inherit whatever their parent purchase said, which
-- is the only information that exists for them.
update public.transaction_lines l
   set team_scope = t.team_scope
  from public.transactions t
 where t.id = l.transaction_id
   and l.team_scope = 'both'
   and t.team_scope <> 'both';

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
begin
  select coalesce(sum((l->>'amount')::numeric), 0)
    into v_total from jsonb_array_elements(p_lines) l;
  if v_total <= 0 then
    raise exception 'An expense needs at least one line with a positive amount';
  end if;

  -- Header marking: an explicit p_team_scope wins; otherwise derive it. All
  -- lines agreeing means the purchase genuinely is that program; a mixed
  -- basket is 'both', which is exactly what "shared" is for.
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
    insert into public.transaction_lines
      (transaction_id, budget_id, amount, shopping_item_id, description,
       fx_currency, fx_amount, fx_rate, team_scope)
    values (
      v_id,
      nullif(v_line->>'budget_id','')::uuid,
      (v_line->>'amount')::numeric,
      nullif(v_line->>'shopping_item_id','')::uuid,
      nullif(v_line->>'description',''),
      nullif(v_line->>'fx_currency',''),
      nullif(v_line->>'fx_amount','')::numeric,
      nullif(v_line->>'fx_rate','')::numeric,
      coalesce(nullif(v_line->>'team_scope',''), 'both')::team_scope
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
