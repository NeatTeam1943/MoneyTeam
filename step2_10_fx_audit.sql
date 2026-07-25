-- ============================================================================
--  Migration 10 — currency conversion audit trail.
--  When an expense/income was actually paid in a foreign currency, these
--  three columns record what was entered and what rate was used, purely for
--  reference — `amount` (already in ILS) stays the one number every report,
--  budget, and balance calculation uses. Nothing else changes behavior.
--  Run after 09.
-- ============================================================================

alter table public.transactions add column if not exists fx_currency text;   -- e.g. 'USD', null = ILS as entered
alter table public.transactions add column if not exists fx_amount   numeric(12,2);  -- the original foreign-currency amount
alter table public.transactions add column if not exists fx_rate     numeric(12,6);  -- rate used at entry time (foreign -> ILS)
