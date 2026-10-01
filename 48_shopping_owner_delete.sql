-- ============================================================================
--  Migration 48 — the person who raised a request may remove it.
--
--  Today only a mentor can delete a shopping row. That is stricter than it
--  needs to be: a student who adds something by mistake, or changes their mind
--  before anyone has acted on it, has to find a mentor to undo their own typo.
--
--  This WIDENS the policy — it does not relax any guard that matters:
--
--    · the row's own author, or
--    · any mentor
--
--  `created_by` already exists on the table with `default auth.uid()`, so the
--  author has been recorded all along; nothing displayed it and nothing used
--  it. Rows created before that default was in place may have a null
--  `created_by`; those stay mentor-only, which is exactly today's behaviour,
--  so no existing row becomes harder OR easier to delete by accident.
--
--  WHAT IS DELIBERATELY NOT INCLUDED: a row that has already been bought is
--  linked to a transaction, and deleting it would leave that purchase pointing
--  at nothing. Those stay mentor-only regardless of who raised them — a
--  purchase is a financial record, not a wish.
--
--  Re-runnable.
-- ============================================================================

drop policy if exists shopping_items_delete on public.shopping_items;

create policy shopping_items_delete on public.shopping_items for delete
  using (
    public.member_role() = 'mentor'
    or (
      created_by = auth.uid()
      -- Not once it is attached to a purchase. At that point the row is part
      -- of a transaction's provenance and removing it orphans the line.
      and transaction_id is null
    )
  );

comment on policy shopping_items_delete on public.shopping_items is
  'Mentors may delete any row. Everyone else may delete only their own, and
   only while it has not been bought — a purchased row is part of a
   transaction''s record.';
