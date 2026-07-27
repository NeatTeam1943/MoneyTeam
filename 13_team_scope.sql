-- ============================================================================
--  Migration 13 — FRC / FTC / BOTH marker ("מארק").
--
--  The team runs two programs out of one budget. Most things are shared, some
--  are specific to one program, so every markable row carries a three-valued
--  scope and defaults to 'both' — existing data keeps working untouched.
--
--  Marked here: categories, shopping items, transactions.
--  Budgets deliberately are NOT marked: a budget hangs off a category, so it
--  inherits that category's scope. Giving budgets their own scope would need
--  the (season_id, category_id) unique key to become a three-way key, which
--  would silently split every existing budget in two.
--
--  Run after 12. Re-runnable.
-- ============================================================================

do $$ begin
  create type team_scope as enum ('frc', 'ftc', 'both');
exception when duplicate_object then null; end $$;

alter table public.categories
  add column if not exists team_scope team_scope not null default 'both';
alter table public.shopping_items
  add column if not exists team_scope team_scope not null default 'both';
alter table public.transactions
  add column if not exists team_scope team_scope not null default 'both';

create index if not exists ix_categories_team on public.categories(team_scope);
create index if not exists ix_shopping_team   on public.shopping_items(team_scope);
create index if not exists ix_tx_team         on public.transactions(team_scope);

-- transactions_view was created with `t.*`, which Postgres expands and freezes
-- at creation time — so it would NOT pick up the new column on its own, and
-- CREATE OR REPLACE can't insert a column before an existing one. Drop and
-- rebuild. (security_invoker keeps RLS evaluated as the calling user, exactly
-- as in migration 09; this view still only narrows payer_name.)
drop view if exists public.transactions_view;

create view public.transactions_view
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

-- Extend save_expense with the scope. Same reasoning as migration 09: drop the
-- old 9-arg signature first, or the added parameter creates a second overload
-- and every existing 9-argument call becomes ambiguous.
drop function if exists public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text);

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
  v_id    uuid;
  v_total numeric(12,2);
  v_line  jsonb;
  v_scope team_scope := coalesce(nullif(p_team_scope, ''), 'both')::team_scope;
begin
  select coalesce(sum((l->>'amount')::numeric), 0)
    into v_total from jsonb_array_elements(p_lines) l;
  if v_total <= 0 then
    raise exception 'An expense needs at least one line with a positive amount';
  end if;

  if p_tx_id is null then
    insert into public.transactions
      (season_id, type, date, amount, account_id, vendor, description, receipt_url, payer_name, team_scope)
    values
      (p_season_id, 'expense', p_date, v_total, p_account_id, p_vendor, p_description, p_receipt_url, p_payer_name, v_scope)
    returning id into v_id;
  else
    update public.transactions set
      date=p_date, amount=v_total, account_id=p_account_id,
      vendor=p_vendor, description=p_description, receipt_url=p_receipt_url,
      payer_name=p_payer_name, team_scope=v_scope
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

revoke all on function public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text,text) from public;
grant execute on function public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text,text) to authenticated;
