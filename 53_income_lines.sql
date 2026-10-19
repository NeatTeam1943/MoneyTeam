-- ============================================================================
--  Migration 53 — income with lines: discounts, per-line accounts, payment
--  method, and one definition of the balance arithmetic.
--
--  Run after 52. Safe to re-run. No enum values, so it is a single file.
--
--  READ THIS BEFORE EDITING: three traps this migration is written around,
--  all of them documented in earlier migrations as having already bitten.
--
--   1. A view defined as `select t.*` FREEZES its column list at creation.
--      Adding a column to a table does nothing visible until the view is
--      rebuilt, and the failure is silent — see 13, 25 and 33. Three such
--      views read the tables this migration changes, and all three are
--      rebuilt at the bottom.
--   2. The balance arithmetic existed in FOUR copies (account_balances,
--      account_balances_guest, balances_as_of, and the guest ledger). They
--      drift. This migration reduces them to one view that the others read.
--   3. A migration runs with no JWT, so member_role() is null and the
--      approval guard rejects writes. Any backfill must disable the trigger
--      — see 33. This migration writes no transaction rows, so it does not
--      need to.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) What an income line has to carry
-- ---------------------------------------------------------------------------
alter table public.transaction_lines
  -- Which account THIS line landed in. Null means "the one on the header",
  -- which is every line that exists today and every expense line.
  add column if not exists account_id     uuid references public.accounts(id),
  -- A receipt shows 3 × 450, not 1350. Kept beside `amount` rather than
  -- replacing it: `amount` stays the one column every balance and report
  -- sums, and these two record how it was arrived at.
  add column if not exists quantity       numeric(12,3) not null default 1,
  add column if not exists unit_price     numeric(14,2),
  add column if not exists payment_method text;

create index if not exists ix_lines_account on public.transaction_lines(account_id);

comment on column public.transaction_lines.account_id is
  'The account this line landed in. Null = the transaction header''s account,
   which is how every pre-existing line and every expense line behaves.';

-- ---------------------------------------------------------------------------
-- 2) Discounts
-- ---------------------------------------------------------------------------
-- A sibling discount is a NEGATIVE line, so that the receipt shows the
-- discount instead of a quietly reduced fee that nobody can reconcile against
-- the price list. The table forbade that outright:
--     amount numeric(12,2) not null check (amount > 0)
-- The constraint is not dropped and forgotten — it is replaced by the rule
-- that actually matters. A line may be anything except zero (a zero line is a
-- typo, never a discount), and the TRANSACTION must still come to more than
-- nothing, which is checked below.
alter table public.transaction_lines drop constraint if exists transaction_lines_amount_check;
alter table public.transaction_lines drop constraint if exists lines_amount_nonzero;
alter table public.transaction_lines add constraint lines_amount_nonzero check (amount <> 0);

-- The net rule, as a DEFERRED constraint trigger.
--
-- Deferred because save_expense edits by deleting every line and reinserting
-- them: midway through that the sum is zero, and an immediate check would
-- reject a perfectly good edit. Deferred to the end of the transaction, it
-- sees only the final state.
create or replace function public.check_lines_net_positive()
returns trigger language plpgsql as $$
declare
  v_tx  uuid := coalesce(new.transaction_id, old.transaction_id);
  v_sum numeric;
  v_n   int;
begin
  select count(*), coalesce(sum(amount), 0) into v_n, v_sum
    from public.transaction_lines where transaction_id = v_tx;
  -- No lines at all is not an error: income without a breakdown, transfers,
  -- and every row written before this migration are in that state.
  if v_n = 0 then return null; end if;
  if v_sum <= 0 then
    raise exception 'The lines of a transaction must come to more than zero (they come to %)', v_sum;
  end if;
  return null;
end $$;

drop trigger if exists trg_lines_net_positive on public.transaction_lines;
create constraint trigger trg_lines_net_positive
  after insert or update or delete on public.transaction_lines
  deferrable initially deferred
  for each row execute function public.check_lines_net_positive();

-- ---------------------------------------------------------------------------
-- 3) Keep an income's header amount equal to its lines
-- ---------------------------------------------------------------------------
-- `transactions.amount` is what every balance reads. Once an income has a
-- breakdown, the two must not be able to disagree — and the client writes the
-- header and the lines in separate requests, so "the form will keep them in
-- step" is not a guarantee, it is a hope.
--
-- Scoped to income on purpose. save_expense already sets an expense header to
-- the sum of its lines, and widening this to every type would mean rewriting
-- a path that works for no reason.
create or replace function public.sync_income_amount_from_lines()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tx  uuid := coalesce(new.transaction_id, old.transaction_id);
  v_sum numeric;
  v_n   int;
begin
  select count(*), coalesce(sum(amount), 0) into v_n, v_sum
    from public.transaction_lines where transaction_id = v_tx;
  if v_n > 0 then
    update public.transactions set amount = v_sum
      where id = v_tx and type = 'income' and amount is distinct from v_sum;
  end if;
  return null;
end $$;

drop trigger if exists trg_sync_income_amount on public.transaction_lines;
create constraint trigger trg_sync_income_amount
  after insert or update or delete on public.transaction_lines
  deferrable initially deferred
  for each row execute function public.sync_income_amount_from_lines();

-- ---------------------------------------------------------------------------
-- 4) ONE definition of what a transaction does to an account
-- ---------------------------------------------------------------------------
-- This replaces four copies of the same arithmetic. They were already drifting
-- apart in shape, and the comment on balances_as_of says outright that it and
-- account_balances "can never disagree" — which was a promise kept by hand.
-- Now they cannot disagree, because they are the same rows.
--
-- The rule for a split income: if ANY of its lines names an account, the
-- income is attributed ENTIRELY by its lines. The form guarantees that when
-- one line names an account they all do; attributing the remainder to the
-- header as well would double-count the money.
drop view if exists public.tx_account_effect cascade;
create view public.tx_account_effect as
  -- income, split across the accounts its lines name
  select l.account_id as account_id, l.amount as delta, t.date as tx_date
    from public.transaction_lines l
    join public.transactions t on t.id = l.transaction_id
   where t.approval = 'approved' and t.type = 'income' and l.account_id is not null
  union all
  -- income with no per-line account: all of it lands on the header account,
  -- which is how every income written before this migration behaves
  select t.account_id, t.amount, t.date
    from public.transactions t
   where t.approval = 'approved' and t.type = 'income'
     and not exists (select 1 from public.transaction_lines l
                      where l.transaction_id = t.id and l.account_id is not null)
  union all
  select t.account_id, -t.amount, t.date from public.transactions t
   where t.approval = 'approved' and t.type = 'expense'
  union all
  select t.account_id, -t.amount, t.date from public.transactions t
   where t.approval = 'approved' and t.type = 'transfer'
  union all
  select t.to_account_id, t.amount, t.date from public.transactions t
   where t.approval = 'approved' and t.type = 'transfer';

comment on view public.tx_account_effect is
  'Every movement of money, one row per account per effect. The single source
   for account_balances, account_balances_guest and balances_as_of — which
   were three hand-maintained copies of the same four rules.';

grant select on public.tx_account_effect to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 5) The balances, rebuilt on top of it
-- ---------------------------------------------------------------------------
drop view if exists public.account_balances;
create view public.account_balances as
select a.id, a.name, a.type, a.currency,
       a.opening_balance
         + coalesce((select sum(e.delta) from public.tx_account_effect e
                      where e.account_id = a.id), 0) as balance
from public.accounts a;
grant select on public.account_balances to authenticated;

drop view if exists public.account_balances_guest;
create view public.account_balances_guest as
select a.id, a.name, a.type, a.currency,
       a.opening_balance
         + coalesce((select sum(e.delta) from public.tx_account_effect e
                      where e.account_id = a.id), 0) as balance
from public.accounts a
where public.can_view_public();
grant select on public.account_balances_guest to authenticated, anon;

-- Same rows, cut off at a date. Previously a verbatim copy of the arithmetic
-- with `and t.date < p_date` pasted in.
--
-- Dropped rather than replaced: `create or replace` cannot change a
-- function's return type, and this one now returns the account type column
-- from the view. Replacing it in place fails with
--   ERROR: cannot change return type of existing function
drop function if exists public.balances_as_of(date) cascade;
create function public.balances_as_of(p_date date)
returns table (id uuid, name text, type account_type, currency text, balance numeric)
language sql stable security definer set search_path = public as $$
  select a.id, a.name, a.type, a.currency,
         a.opening_balance
           + coalesce((select sum(e.delta) from public.tx_account_effect e
                        where e.account_id = a.id and e.tx_date < p_date), 0)
  from public.accounts a;
$$;
revoke all on function public.balances_as_of(date) from public;
grant execute on function public.balances_as_of(date) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 6) Rebuild the views that froze their column lists
-- ---------------------------------------------------------------------------
-- ledger_lines and ledger_lines_full must see the new line columns, or an
-- income breakdown is invisible to everything that reads lines.
drop view if exists public.ledger_lines cascade;
create view public.ledger_lines
  with (security_invoker = true) as
select l.* from public.transaction_lines l
join public.transactions t on t.id = l.transaction_id
where t.approval = 'approved';
grant select on public.ledger_lines to authenticated;

drop view if exists public.ledger_lines_full cascade;
create view public.ledger_lines_full
  with (security_invoker = true) as
select
  l.id, l.transaction_id, l.budget_id, l.amount, l.description,
  l.shopping_item_id, l.fx_currency, l.fx_amount, l.fx_rate,
  l.team_scope, l.category_id,
  l.account_id, l.quantity, l.unit_price, l.payment_method,
  t.season_id, t.date, t.team_scope as tx_team_scope, t.type as tx_type
from public.transaction_lines l
join public.transactions t on t.id = l.transaction_id
where t.approval = 'approved';
grant select on public.ledger_lines_full to authenticated;

-- Verify:
--   select name, balance from public.account_balances order by name;
--   select * from public.tx_account_effect order by tx_date;
