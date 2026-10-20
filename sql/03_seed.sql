-- ============================================================================
--  Migration 03 — OPTIONAL starter data
--  Gives you a working season, common accounts, categories, and priority
--  levels so the app isn't empty on first login. Safe to skip or edit.
--  Run after 01 + 02. Uses ON CONFLICT-free guards via NOT EXISTS.
-- ============================================================================

-- Active season for the current year
insert into public.seasons (name, start_date, end_date, is_active)
select concat(extract(year from now())::int, ' Season'),
       make_date(extract(year from now())::int, 1, 1),
       make_date(extract(year from now())::int, 12, 31),
       true
where not exists (select 1 from public.seasons);

-- Accounts
insert into public.accounts (name, type, opening_balance)
select v.name, v.type::account_type, 0
from (values
  ('Bank account', 'bank'),
  ('School fund',  'school'),
  ('Store credit', 'store_credit'),
  ('City fund',    'city'),
  ('Petty cash',   'cash')
) as v(name, type)
where not exists (select 1 from public.accounts a where a.name = v.name);

-- Expense categories
insert into public.categories (name, color)
select v.name, v.color
from (values
  ('Parts',        '#ff9100'),
  ('Tools',        '#4d63ff'),
  ('Fabrication',  '#b06bff'),
  ('Electronics',  '#35c26b'),
  ('Travel',       '#ffc14d'),
  ('Registration', '#ff4d5e'),
  ('Marketing',    '#7aa0ff'),
  ('Food',         '#d98aff'),
  ('Safety',       '#8a8aa0')
) as v(name, color)
where not exists (select 1 from public.categories c where c.name = v.name);

-- Priority levels (lower rank = more urgent)
insert into public.priority_levels (name, rank, color)
select v.name, v.rank, v.color
from (values
  ('Critical',     1, '#ff4d5e'),
  ('Needed',       2, '#ff9100'),
  ('Nice to have', 3, '#4d63ff')
) as v(name, rank, color)
where not exists (select 1 from public.priority_levels p where p.name = v.name);
