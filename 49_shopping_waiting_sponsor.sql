-- ============================================================================
--  Migration 49 — a "waiting for sponsor" status for shopping items.
--
--  Run after 01 and 04 (which created and last extended the enum).
--  Safe to re-run: `if not exists` makes it a no-op the second time.
-- ============================================================================

-- An item nobody has agreed to pay for yet, but that the team hopes a sponsor
-- will cover. It is NOT a cancelled request and NOT an approved purchase, and
-- before this it had to be filed as one of the two — which either lost it from
-- the outstanding list or implied the team had agreed to buy it.
--
-- `add value` cannot run inside a transaction block, so this statement must be
-- the whole thing you execute. Supabase's SQL editor runs it as its own
-- statement, so pasting the file as-is is fine; a script wrapping it in
-- begin/commit would fail with "ALTER TYPE ... ADD cannot run inside a
-- transaction block".
alter type shopping_status add value if not exists 'waiting_sponsor';

-- Nothing else changes. The status column keeps its 'pending_approval'
-- default (set in 04), and the trigger that restricts status changes to
-- mentors (trg_guard_shopping_status, also 04) checks WHO is changing the
-- status, never which value it is moving to — so it covers the new value
-- already, with no change here.
--
-- Verify:
--   select unnest(enum_range(null::shopping_status));
-- should list: wish, approved, ordered, received, cancelled, pending_approval,
-- waiting_sponsor   (enum_range reports creation order, not display order —
--                    the app decides the order it shows them in.)
