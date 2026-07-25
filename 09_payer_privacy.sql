-- ============================================================================
--  Migration 09 — payer privacy.
--  Who specifically paid (a student's name, a mentor's name for a
--  reimbursement) is split out of the free-text description into its own
--  column, and a view masks that one column to '***' for anyone who isn't a
--  mentor. Amount / date / category / vendor stay visible to everyone as
--  before — only the named-individual detail is restricted.
--  Run after 08.
-- ============================================================================

alter table public.transactions add column if not exists payer_name text;

-- security_invoker means this view re-checks the underlying table's RLS as
-- the CALLING user, so read access rules are unchanged — this view only
-- narrows one column, it does not widen who can see a row at all.
create or replace view public.transactions_view
  with (security_invoker = true) as
select
  t.*,
  case
    when public.member_role() = 'mentor' then t.payer_name
    when t.payer_name is not null then '***'
    else null
  end as payer_display
from public.transactions t;

grant select on public.transactions_view to authenticated;

-- Extend save_expense to accept an optional payer_name (who to reimburse, if
-- relevant). Drop the old 8-arg signature first — CREATE OR REPLACE with an
-- added parameter creates a second overload instead of replacing it, and the
-- app's existing 8-argument calls would then be ambiguous between the two.
drop function if exists public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb);

create or replace function public.save_expense(
  p_tx_id        uuid,
  p_season_id    uuid,
  p_date         date,
  p_account_id   uuid,
  p_vendor       text,
  p_description  text,
  p_receipt_url  text,
  p_lines        jsonb,
  p_payer_name   text default null
) returns uuid
language plpgsql
as $$
declare
  v_id    uuid;
  v_total numeric(12,2);
  v_line  jsonb;
begin
  select coalesce(sum((l->>'amount')::numeric), 0)
    into v_total from jsonb_array_elements(p_lines) l;
  if v_total <= 0 then
    raise exception 'An expense needs at least one line with a positive amount';
  end if;

  if p_tx_id is null then
    insert into public.transactions
      (season_id, type, date, amount, account_id, vendor, description, receipt_url, payer_name)
    values
      (p_season_id, 'expense', p_date, v_total, p_account_id, p_vendor, p_description, p_receipt_url, p_payer_name)
    returning id into v_id;
  else
    update public.transactions set
      date=p_date, amount=v_total, account_id=p_account_id,
      vendor=p_vendor, description=p_description, receipt_url=p_receipt_url, payer_name=p_payer_name
      where id=p_tx_id;
    v_id := p_tx_id;
    delete from public.transaction_lines where transaction_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.transaction_lines
      (transaction_id, budget_id, amount, shopping_item_id, description)
    values (
      v_id,
      nullif(v_line->>'budget_id','')::uuid,
      (v_line->>'amount')::numeric,
      nullif(v_line->>'shopping_item_id','')::uuid,
      nullif(v_line->>'description','')
    );
    if nullif(v_line->>'shopping_item_id','') is not null then
      update public.shopping_items
        set status='ordered', transaction_id=v_id
        where id = (v_line->>'shopping_item_id')::uuid;
    end if;
  end loop;

  return v_id;
end $$;

revoke all on function public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text) from public;
grant execute on function public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text) to authenticated;
