-- ============================================================================
--  Migration 11 — pending users.
--  Lets a mentor see anyone who has an auth account (e.g. just signed in with
--  Google for the first time) but no members row yet, and grant them a role
--  without needing to know or type their raw user id. Read access is
--  mentor-only — this view only ever exposes id/email/created_at, never
--  anything else from auth.users.
--  Run after 10.
-- ============================================================================

-- No security_invoker here on purpose: a regular authenticated role has NO
-- grant on auth.users at all (only Supabase's internal service does), so
-- this view must run with its OWNER's privileges to read it. Access control
-- instead comes from member_role() in the WHERE clause below — that
-- function is SECURITY DEFINER and correctly reflects whoever is actually
-- calling, so a non-mentor querying this view still gets zero rows.
create or replace view public.pending_users as
select u.id, u.email, u.created_at
from auth.users u
where not exists (select 1 from public.members m where m.id = u.id)
  and public.member_role() = 'mentor';

grant select on public.pending_users to authenticated;

