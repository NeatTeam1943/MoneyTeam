-- ============================================================================
--  Migration 20 — budgets belong to a program, and the pots stop lying.
--
--  The team is two programs under one management. Some money is shared, most
--  is not. Until now a budget had no program of its own — it borrowed one from
--  its category — which made two things impossible:
--
--    1. FRC and FTC could not each hold a budget for the SAME category. The
--       unique key was (season_id, category_id), so "חומרי גלם" was one pot
--       for both programs whether or not that was true.
--    2. An FRC expense could be charged against an FTC budget and nothing
--       objected.
--
--  Both are fixed here. A budget now carries team_scope, the unique key
--  includes it, and a trigger refuses to charge a line from one program to a
--  budget belonging to the other. A shared ('both') budget still accepts
--  anything — that is what shared means.
--
--  NOT changed, deliberately: how much a budget has consumed. Spend is
--  whatever was charged to that budget, full stop. The FRC/FTC filter chooses
--  which budgets you LOOK at; it must never shrink the consumed figure of a
--  shared pot, or the remaining balance reads higher than the money that is
--  actually there.
--
--  Run after 17. Re-runnable.
-- ============================================================================

alter table public.budgets
  add column if not exists team_scope team_scope not null default 'both';

-- A budget's program starts as its category's, which is the only signal that
-- exists today. Overall (no category) stays shared.
update public.budgets b
   set team_scope = c.team_scope
  from public.categories c
 where c.id = b.category_id
   and b.team_scope = 'both'
   and c.team_scope <> 'both';

-- One pot per category PER PROGRAM, instead of one pot per category.
alter table public.budgets drop constraint if exists budgets_season_id_category_id_key;
create unique index if not exists budgets_season_category_scope_key
  on public.budgets (season_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), team_scope);

create index if not exists ix_budgets_team on public.budgets(team_scope);

-- ----------------------------------------------------------------------------
--  An FRC expense must not come out of an FTC budget.
--
--  Only genuinely opposed pairs are refused. Anything involving 'both' is
--  allowed in either direction: a shared pot absorbs either program's spend,
--  and a shared expense can legitimately be charged to one program's budget
--  (that is the mentor deciding who pays for it).
-- ----------------------------------------------------------------------------
create or replace function public.guard_line_budget_scope()
returns trigger
language plpgsql
as $$
declare
  v_budget team_scope;
begin
  if new.budget_id is null then
    return new;
  end if;

  select team_scope into v_budget from public.budgets where id = new.budget_id;

  if v_budget is not null
     and v_budget <> 'both'
     and new.team_scope <> 'both'
     and v_budget <> new.team_scope then
    raise exception
      'Cannot charge a % line to a % budget — they belong to different programs',
      new.team_scope, v_budget;
  end if;

  return new;
end $$;

drop trigger if exists trg_line_budget_scope on public.transaction_lines;
create trigger trg_line_budget_scope
  before insert or update on public.transaction_lines
  for each row execute function public.guard_line_budget_scope();

-- ----------------------------------------------------------------------------
--  Shopping items are requests against a category, so the same rule applies
--  when one is later turned into a purchase. Nothing is enforced here — an
--  unpriced wish sitting in the wrong program is harmless — but the app uses
--  this to offer only sensible budgets when buying.
-- ----------------------------------------------------------------------------
create index if not exists ix_shopping_team_cat
  on public.shopping_items(team_scope, category_id);
