-- ============================================================================
--  Migration 31 — keep the working behind a budget figure. (issue #3)
--
--  A budget is currently a single number. How it was arrived at —
--  "FTC comp food, 18 kids × ₪45" plus "regular day food, 30 students × ₪12" —
--  lives in someone's head or a spreadsheet, and is gone by the time anyone
--  asks why the number is what it is.
--
--  jsonb rather than a child table, deliberately. These rows are only ever
--  read and written as a whole, with the budget, and nothing joins to an
--  individual line: no foreign keys point at them, no query filters by them,
--  no report aggregates them. A table would add a migration, a policy and a
--  join to buy indexing nobody needs.
--
--  Shape:
--    [{ "label": "FTC comp food per kid", "qty": 18, "unit": 45 }, ...]
--
--  The amount is NOT derived from this. The calculator fills the amount in,
--  and after that the two are independent: a mentor may round ₪1,847 up to
--  ₪2,000, and that decision must survive. The app shows the calculated total
--  beside the amount whenever they differ, so a stale calculation is visible
--  rather than silently overriding a deliberate figure.
--
--  Re-runnable.
-- ============================================================================

alter table public.budgets
  add column if not exists calc jsonb not null default '[]'::jsonb;

-- Reject anything that is not an array of objects: a malformed value would
-- otherwise surface as a broken calculator rather than a rejected write.
do $$ begin
  alter table public.budgets
    add constraint budgets_calc_is_array
    check (jsonb_typeof(calc) = 'array');
exception when duplicate_object then null; end $$;

comment on column public.budgets.calc is
  'Optional working behind the amount: [{label, qty, unit}]. Informational — the amount is authoritative.';
