-- ============================================================================
--  Migration 05 — expenses draw from a budget (not a category).
--  Run after 04. Single block, safe to run as one script.
-- ============================================================================
alter table public.transactions
  add column if not exists budget_id uuid references public.budgets(id) on delete set null;
create index if not exists ix_tx_budget on public.transactions(budget_id);
