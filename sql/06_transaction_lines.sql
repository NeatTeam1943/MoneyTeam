-- ============================================================================
--  Migration 06 — split expenses into lines (header/detail).
--  One purchase (transaction) = one receipt, one total, one account.
--  Its lines each charge a budget. Total = sum(lines).  Run after 05.
-- ============================================================================

create table if not exists public.transaction_lines (
  id               uuid primary key default gen_random_uuid(),
  transaction_id   uuid not null references public.transactions(id) on delete cascade,
  budget_id        uuid references public.budgets(id) on delete set null,
  amount           numeric(12,2) not null check (amount > 0),
  shopping_item_id uuid references public.shopping_items(id) on delete set null,
  description      text,
  created_at       timestamptz not null default now()
);
create index if not exists ix_lines_tx     on public.transaction_lines(transaction_id);
create index if not exists ix_lines_budget on public.transaction_lines(budget_id);
create index if not exists ix_lines_item   on public.transaction_lines(shopping_item_id);

-- Deleting an expense should free any shopping item it fulfilled (not block it)
alter table public.shopping_items drop constraint if exists shopping_items_transaction_id_fkey;
alter table public.shopping_items
  add constraint shopping_items_transaction_id_fkey
  foreign key (transaction_id) references public.transactions(id) on delete set null;

-- RLS: read = any member, write = mentor (lines are part of expenses)
alter table public.transaction_lines enable row level security;
alter table public.transaction_lines force  row level security;
drop policy if exists lines_read  on public.transaction_lines;
drop policy if exists lines_write on public.transaction_lines;
create policy lines_read  on public.transaction_lines for select using (public.member_role() is not null);
create policy lines_write on public.transaction_lines for all
  using (public.member_role() = 'mentor') with check (public.member_role() = 'mentor');

-- Atomic save: create/replace an expense + its lines, link fulfilled shopping
-- items, and set the header total to the sum of the lines. Runs as the caller,
-- so RLS (mentor-only) still applies.
create or replace function public.save_expense(
  p_tx_id        uuid,
  p_season_id    uuid,
  p_date         date,
  p_account_id   uuid,
  p_vendor       text,
  p_description  text,
  p_receipt_url  text,
  p_lines        jsonb
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
      (season_id, type, date, amount, account_id, vendor, description, receipt_url)
    values
      (p_season_id, 'expense', p_date, v_total, p_account_id, p_vendor, p_description, p_receipt_url)
    returning id into v_id;
  else
    update public.transactions set
      date=p_date, amount=v_total, account_id=p_account_id,
      vendor=p_vendor, description=p_description, receipt_url=p_receipt_url
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

revoke all on function public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb) from public;
grant execute on function public.save_expense(uuid,uuid,date,uuid,text,text,text,jsonb) to authenticated;
