-- ============================================================================
--  Migration 36 — indexes for the balance and ledger scans.
--
--  account_balances joins transactions with
--
--      on t.account_id = a.id or t.to_account_id = a.id
--
--  An OR across two columns cannot use an index on either: Postgres has no way
--  to combine them into one lookup, so it scans every transaction and filters
--  in memory. With 141 rows that is invisible. It grows linearly with the
--  ledger, and every page that shows a balance pays it.
--
--  The two indexes below let the planner satisfy each side separately and
--  combine them with a bitmap OR, which is what it wants to do here.
--
--  This is the cheap half of the answer. The expensive half — storing balances
--  instead of deriving them — is deliberately NOT done; see the note at the
--  bottom.
--
--  Re-runnable.
-- ============================================================================

create index if not exists ix_tx_account          on public.transactions (account_id);
create index if not exists ix_tx_to_account       on public.transactions (to_account_id) where to_account_id is not null;
create index if not exists ix_tx_season_approval  on public.transactions (season_id, approval);
create index if not exists ix_lines_transaction   on public.transaction_lines (transaction_id);
create index if not exists ix_lines_budget        on public.transaction_lines (budget_id) where budget_id is not null;
create index if not exists ix_shopping_season     on public.shopping_items (season_id, status);

analyze public.transactions;
analyze public.transaction_lines;
analyze public.shopping_items;

-- ----------------------------------------------------------------------------
-- ON STORING BALANCES INSTEAD OF DERIVING THEM
--
-- Tempting, and I think wrong for this app.
--
-- A stored balance is a second copy of a number the ledger already determines.
-- It has to be updated by every insert, update and delete on transactions —
-- including the ones that change an amount, move a transaction between
-- accounts, flip an approval, or back-date a row. Miss one path and the stored
-- figure is quietly wrong, and a quietly wrong balance is far worse than a slow
-- correct one: it is the number people act on, and nothing on screen would say
-- it had drifted.
--
-- The derived view cannot drift. It is arithmetic over the rows, every time.
--
-- The size argues the same way: a season is a few hundred transactions, and
-- this team has 141. Postgres aggregates that in well under a millisecond once
-- the indexes above exist. There is no performance problem here worth trading
-- correctness for.
--
-- If loading still feels slow after this, the cause is almost certainly the
-- five or six separate round trips each page makes — a network cost, not a
-- database one — and the fix is to reduce or parallelise those requests, which
-- is a change in the app rather than the schema.
-- ============================================================================
