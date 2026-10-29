-- ============================================================================
--  Migration 57 — the balance is what has actually arrived.
--
--  Run after 56. Safe to re-run.
--
--  THE PROBLEM. A parent pays with one cash payment and three post-dated
--  cheques. Each cheque is recorded as its own income with its own future
--  date, which is right: they are four separate movements of money and the
--  bank will see them months apart.
--
--  But account_balances summed EVERY approved transaction with no regard for
--  its date, so all four landed in the balance the moment they were typed in.
--  The dashboard's "balance on hand" — whose entire job is to answer "how much
--  money is actually there" — was overstated by the full value of the cheques,
--  and so was every page built on it. The savings goals are the worst of them:
--  goals.js says in as many words that `available` is "the money actually in
--  the accounts", and it was being handed a figure that included money nobody
--  can spend yet. A goal could read as funded out of three cheques that have
--  not been banked.
--
--  THE RULE. A movement counts from its date onward. Money dated ahead is not
--  in the account; it is expected. This needs no new column and no upkeep: the
--  date is already on the row and already means exactly this. A cheque joins
--  the balance on the day it is due, by itself.
--
--  What it does NOT do is notice a cheque that bounced or was banked late —
--  such a row flips to "arrived" on its date regardless. That is a deliberate
--  trade. The alternative is a "cleared" box to tick on every row months after
--  the fact, and a field that depends on someone remembering is a field that
--  quietly lies. The exception should be handled as an exception, by correcting
--  the row that misbehaved.
--
--  Budgets are untouched by any of this: they are allocations set by hand and
--  never read income at all. A post-dated cheque changes the bank balance and
--  the savings goals, and nothing else.
-- ============================================================================

-- Israeli dates, not the server's. The database runs in UTC, so between
-- midnight and 02:00 (03:00 in summer) Israel time `current_date` is still
-- yesterday — and a cheque due today would spend a couple of hours counted as
-- still ahead. Cheap to get right, confusing to debug if left wrong.
create or replace function public.today_local()
returns date language sql stable as
  $$ select (now() at time zone 'Asia/Jerusalem')::date $$;

comment on function public.today_local() is
  'Today, in the time zone the team actually lives in. The balance cut-off.';

grant execute on function public.today_local() to authenticated, anon;

-- ---------------------------------------------------------------------------
--  The balances
-- ---------------------------------------------------------------------------
-- `balance`  — what has arrived, and what the word means everywhere in the app
-- `expected` — the net of everything still dated ahead
--
-- Both come from tx_account_effect, which is still the one place the arithmetic
-- lives (migration 53). The sum of the two is the old number, for anyone who
-- wants "where this account ends up if everything lands".
drop view if exists public.account_balances;
create view public.account_balances as
select a.id, a.name, a.type, a.currency,
       a.opening_balance
         + coalesce((select sum(e.delta) from public.tx_account_effect e
                      where e.account_id = a.id
                        and e.tx_date <= public.today_local()), 0) as balance,
       coalesce((select sum(e.delta) from public.tx_account_effect e
                  where e.account_id = a.id
                    and e.tx_date > public.today_local()), 0) as expected
from public.accounts a;
grant select on public.account_balances to authenticated;

drop view if exists public.account_balances_guest;
create view public.account_balances_guest as
select a.id, a.name, a.type, a.currency,
       a.opening_balance
         + coalesce((select sum(e.delta) from public.tx_account_effect e
                      where e.account_id = a.id
                        and e.tx_date <= public.today_local()), 0) as balance,
       coalesce((select sum(e.delta) from public.tx_account_effect e
                  where e.account_id = a.id
                    and e.tx_date > public.today_local()), 0) as expected
from public.accounts a
where public.can_view_public();
grant select on public.account_balances_guest to authenticated, anon;

comment on view public.account_balances is
  'balance = money that has arrived (dated up to today). expected = the net of
   movements still dated ahead, which is where a post-dated cheque sits until
   it is due. Their sum is the pre-57 figure.';

-- balances_as_of(date) is deliberately NOT touched: it already cuts at a date,
-- and season_opening_balances — its only caller — asks for the balance at the
-- start of a season, which must keep meaning exactly that.

notify pgrst, 'reload schema';

-- Verify — the two numbers should differ by the post-dated money:
--   select name, balance, expected from public.account_balances order by name;
