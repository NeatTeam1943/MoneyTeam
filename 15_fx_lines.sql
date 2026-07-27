-- ============================================================================
--  Migration 15 — persist the FX breadcrumb on expense LINES.
--
--  Why: transactions already had fx_currency/fx_amount/fx_rate (migration 10),
--  but they were only ever written by the direct insert path — income and
--  transfers. An EXPENSE is saved through save_expense(), which never touched
--  those columns, and its currency entry happens per line anyway (one purchase
--  can mix a $ part and a ₪ part). Net effect: every foreign-currency expense
--  silently threw its rate away. The production dump confirms it — zero rows
--  with fx_currency set, despite the feature shipping months ago.
--
--  Each line now carries its own currency/amount/rate, and the header keeps a
--  copy when the whole purchase was in one currency, so existing reads that
--  look at the transaction row still work.
--
--  Run after 13. Re-runnable.
-- ============================================================================

alter table public.transaction_lines
  add column if not exists fx_currency text,
  add column if not exists fx_amount   numeric(12,2),
  add column if not exists fx_rate     numeric(12,6);

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
  p_team_scope   text default 'both'
) returns uuid
language plpgsql
as $$
declare
  v_id      uuid;
  v_total   numeric(12,2);
  v_line    jsonb;
  v_scope   team_scope := coalesce(nullif(p_team_scope, ''), 'both')::team_scope;
  v_cur     text;
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

  -- Header-level fx is only meaningful when the WHOLE purchase used a single
  -- foreign currency; a mixed basket leaves the header null and keeps the
  -- detail on the lines, where it is unambiguous.
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
       fx_currency, fx_amount, fx_rate)
    values (
      v_id,
      nullif(v_line->>'budget_id','')::uuid,
      (v_line->>'amount')::numeric,
      nullif(v_line->>'shopping_item_id','')::uuid,
      nullif(v_line->>'description',''),
      nullif(v_line->>'fx_currency',''),
      nullif(v_line->>'fx_amount','')::numeric,
      nullif(v_line->>'fx_rate','')::numeric
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
