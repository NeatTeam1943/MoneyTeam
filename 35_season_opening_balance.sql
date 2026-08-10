-- ============================================================================
--  Migration 35 — what the season opened with.
--
--  "How much was in the accounts when this season started" cannot be answered
--  from the season's own rows: everything before its start date belongs to an
--  earlier season, and account_balances deliberately spans all of them.
--
--  So this is a function, not a column. The figure is derived — it is the sum
--  of every approved movement before a date — and storing it would create a
--  second version of the truth that drifts the moment anyone back-dates a
--  transaction, which happens.
--
--  Also adds the index that makes the date scan cheap; the balances view has
--  always scanned transactions by account, and now something scans by date.
--
--  Re-runnable.
-- ============================================================================

create index if not exists ix_transactions_date_approved
  on public.transactions (date)
  where approval = 'approved';

-- Balance per account as of the moment just BEFORE `p_date`.
--
-- Mirrors account_balances exactly — same four movement rules, same
-- opening_balance base — so "opening balance" and "balance now" can never
-- disagree about what a transfer or an in-kind row does. In-kind is excluded
-- there by carrying no account, and that holds here too.
create or replace function public.balances_as_of(p_date date)
returns table (id uuid, name text, balance numeric)
language sql
stable
as $$
  select
    a.id,
    a.name,
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
   and t.date < p_date
  group by a.id, a.name, a.opening_balance;
$$;

revoke all on function public.balances_as_of(date) from public;
grant execute on function public.balances_as_of(date) to authenticated;

-- The same thing for a season, so the app does not have to know that "opening"
-- means "the day the season starts".
create or replace function public.season_opening_balances(p_season_id uuid)
returns table (id uuid, name text, balance numeric)
language sql
stable
as $$
  select b.id, b.name, b.balance
  from public.seasons s
  cross join lateral public.balances_as_of(s.start_date) b
  where s.id = p_season_id;
$$;

revoke all on function public.season_opening_balances(uuid) from public;
grant execute on function public.season_opening_balances(uuid) to authenticated;
