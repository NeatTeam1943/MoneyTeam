-- ============================================================================
--  Migration 33 — more than one receipt per transaction.
--
--  One purchase can produce several documents: the supplier's invoice, the
--  bank's fee slip for the transfer that paid it, a customs charge. Today only
--  one can be attached, so the rest live in someone's email.
--
--  Same shape as migration 30 did for shopping links, and for the same reason:
--  `receipt_url` STAYS and keeps holding the first receipt. That means this SQL
--  can run before the new code is deployed without breaking the running build,
--  a rollback still finds the receipt it expects, and the Excel backup in the
--  other repo — which reads receipt_url — keeps working untouched.
--
--  Re-runnable.
-- ============================================================================

alter table public.transactions
  add column if not exists receipt_urls text[] not null default '{}';

-- The approval guard from migration 22 raises on any UPDATE to an approved
-- transaction by a non-mentor. A migration runs as the table owner with no JWT,
-- so member_role() is null and the backfill would be refused — exactly the trap
-- migration 21 hit. Disable triggers for the backfill only: it touches one new
-- column and changes no money, no approval and no pairing.
alter table public.transactions disable trigger user;

-- Existing single receipts become the first entry, so nothing is re-uploaded.
update public.transactions
   set receipt_urls = array[btrim(receipt_url)]
 where receipt_url is not null
   and btrim(receipt_url) <> ''
   and cardinality(receipt_urls) = 0;

alter table public.transactions enable trigger user;

-- Blanks and duplicates are stripped on the way in, so no read site has to
-- defend against them, and receipt_url is kept equal to the first entry.
create or replace function public.tidy_receipt_urls()
returns trigger
language plpgsql
as $$
begin
  if new.receipt_urls is null then
    new.receipt_urls := '{}';
  else
    select coalesce(array_agg(u), '{}')
      into new.receipt_urls
      from (select distinct btrim(x) as u
              from unnest(new.receipt_urls) as x
             where btrim(coalesce(x, '')) <> '') s;
  end if;

  -- Only take over receipt_url when the array is actually in play. A build
  -- that still writes receipt_url alone must not have it wiped by a trigger
  -- that sees an empty array — that would delete the receipt it just attached.
  if cardinality(new.receipt_urls) > 0 then
    new.receipt_url := new.receipt_urls[1];
  elsif new.receipt_url is not null and btrim(new.receipt_url) <> '' then
    new.receipt_urls := array[btrim(new.receipt_url)];
  end if;

  return new;
end $$;

drop trigger if exists trg_tidy_receipt_urls on public.transactions;
create trigger trg_tidy_receipt_urls
  before insert or update on public.transactions
  for each row execute function public.tidy_receipt_urls();

-- Bring existing rows through the tidy trigger once so the two columns agree
-- from the outset rather than only after the next edit.
alter table public.transactions disable trigger trg_transaction_approval;
update public.transactions set receipt_urls = receipt_urls;
alter table public.transactions enable trigger trg_transaction_approval;

-- save_expense gains the list. receipt_url is still accepted so an older
-- client keeps working; when both arrive the array wins.
drop function if exists public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text,text,boolean);

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
  p_propose      boolean default false,
  p_receipt_urls text[] default null
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
  v_rcpts   text[];
begin
  select coalesce(sum((l->>'amount')::numeric), 0)
    into v_total from jsonb_array_elements(p_lines) l;
  if v_total <= 0 then
    raise exception 'An expense needs at least one line with a positive amount';
  end if;

  v_rcpts := coalesce(
    p_receipt_urls,
    case when nullif(p_receipt_url, '') is null then '{}'::text[]
         else array[p_receipt_url] end);

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
      (season_id, type, date, amount, account_id, vendor, description,
       receipt_url, receipt_urls,
       payer_name, team_scope, fx_currency, fx_amount, fx_rate, approval)
    values
      (p_season_id, 'expense', p_date, v_total, p_account_id, p_vendor, p_description,
       nullif(p_receipt_url, ''), v_rcpts,
       p_payer_name, v_scope, v_hdr_cur, v_hdr_amt, v_hdr_rt, v_appr)
    returning id into v_id;
  else
    update public.transactions set
      date=p_date, amount=v_total, account_id=p_account_id,
      vendor=p_vendor, description=p_description,
      receipt_url=nullif(p_receipt_url, ''), receipt_urls=v_rcpts,
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
    if nullif(v_line->>'shopping_item_id','') is not null and v_appr = 'approved' then
      update public.shopping_items
        set status='ordered', transaction_id=v_id
        where id = (v_line->>'shopping_item_id')::uuid;
    end if;
  end loop;

  return v_id;
end $$;

revoke all on function public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text,text,boolean,text[]) from public;
grant execute on function public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb,text,text,boolean,text[]) to authenticated;

-- The guest view exposes no receipts at all, and must not start now.
-- (transactions_guest selects columns explicitly, so receipt_urls is excluded
--  by omission — stated here so a future rebuild of that view remembers.)

-- ----------------------------------------------------------------------------
-- transactions_view was created with `t.*`, which Postgres expands and FREEZES
-- at creation time — it does not track the table's shape. Migration 25 exists
-- because migration 22 added a column and forgot this; adding receipt_urls
-- without rebuilding the view would repeat that exactly, and the failure is
-- silent: the ledger would read every row with receipt_urls undefined and
-- quietly show one receipt instead of several.
drop view if exists public.transactions_view;

create view public.transactions_view
  with (security_invoker = true) as
select
  t.*,
  case
    when public.member_role() = 'mentor' then t.payer_name
    when t.payer_name is not null then '***'
    else null
  end as payer_display,
  m.full_name as proposer_name
from public.transactions t
left join public.members m on m.id = t.proposed_by;

grant select on public.transactions_view to authenticated;
