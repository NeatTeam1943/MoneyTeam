-- ============================================================================
--  Migration 24 — merge the program-suffixed categories into their parents.
--
--  "אלקטרוניקה FRC", "מנועי FTC" and the rest were never categories anyone
--  wanted; they existed because, before migration 21, a line's category came
--  from its budget, so the only way to see spending under a useful name was to
--  create a category and budget with that name. Migration 21 removed that
--  constraint. These eight can go back to being one category plus an
--  attribute.
--
--  THE PART THAT MATTERS
--  Right now the CATEGORY carries program information the ROWS do not:
--
--      אלקטרוניקה FRC   17 items marked 'both', 5 marked 'frc'
--      מנועי FRC         1 line  marked 'both', 2 marked 'frc'
--
--  Those 'both' rows are not shared purchases. They are FRC purchases whose
--  program was never typed in, because the category name already said it. Merge
--  them naively and they become genuinely shared — the information is gone and
--  nothing warns you.
--
--  So the merge WRITES the category's program onto its rows, with one
--  exception that matters just as much:
--
--      only rows marked 'both' inherit it.
--
--  A row already marked 'frc' or 'ftc' was marked deliberately and is more
--  specific than its container. "מנועי FRC" holds one line marked 'ftc' — an
--  FTC purchase charged to the FRC pot. Overwriting that to 'frc' would
--  destroy a real fact to tidy a name.
--
--  No money moves. Amounts, budgets and per-budget spend are untouched; only
--  category_id and (where it was unset) team_scope change.
--
--  Run after 23. Re-runnable: once the eight are gone it does nothing.
-- ============================================================================

do $$
declare
  r record;
  v_lines int := 0;
  v_items int := 0;
  v_budgets int := 0;
  v_inherited_lines int := 0;
  v_inherited_items int := 0;
begin
  for r in
    select c.id, c.name, c.team_scope, c.parent_id, p.name as parent_name
      from public.categories c
      join public.categories p on p.id = c.parent_id
     where c.name ~ '(FRC|FTC)'
       and c.team_scope <> 'both'
  loop
    -- 1. rows that never had a program of their own inherit the category's
    update public.transaction_lines
       set team_scope = r.team_scope
     where category_id = r.id and team_scope = 'both';
    get diagnostics v_inherited_lines = row_count;

    update public.shopping_items
       set team_scope = r.team_scope
     where category_id = r.id and team_scope = 'both';
    get diagnostics v_inherited_items = row_count;

    -- 2. everything moves up to the parent category
    update public.transaction_lines set category_id = r.parent_id where category_id = r.id;
    get diagnostics v_lines = row_count;

    update public.shopping_items set category_id = r.parent_id where category_id = r.id;
    get diagnostics v_items = row_count;

    -- 3. the budget keeps its own program and simply sits on the parent now.
    --    (season_id, category_id, team_scope) is unique since migration 20, so
    --    an FRC and an FTC pot can share the parent category quite happily.
    update public.budgets set category_id = r.parent_id where category_id = r.id;
    get diagnostics v_budgets = row_count;

    raise notice '% -> %  (lines % / items %, program written onto % lines and % items, budgets %)',
      r.name, r.parent_name, v_lines, v_items, v_inherited_lines, v_inherited_items, v_budgets;

    delete from public.categories where id = r.id;
  end loop;
end $$;

-- The parents were only ever containers for the split; nothing should still
-- point at a category that no longer exists.
do $$
declare v_orphan int;
begin
  select count(*) into v_orphan
    from public.transaction_lines l
   where l.category_id is not null
     and not exists (select 1 from public.categories c where c.id = l.category_id);
  if v_orphan > 0 then
    raise exception 'Merge left % lines pointing at a missing category', v_orphan;
  end if;
end $$;
