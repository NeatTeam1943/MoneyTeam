-- ============================================================================
--  Migration 12 — pending users now show a name, not just an email.
--  When someone signs in with Google for the first time, the app asks them
--  to confirm/edit their name and stores it on their own auth profile
--  (auth.users.raw_user_meta_data ->> 'full_name'). This just surfaces that
--  in the pending_users view so a mentor sees a name, not only an email.
--  Run after 11.
-- ============================================================================

drop view if exists public.pending_users;
create view public.pending_users as
select
  u.id,
  u.email,
  u.raw_user_meta_data ->> 'full_name' as full_name,
  u.created_at
from auth.users u
where not exists (select 1 from public.members m where m.id = u.id)
  and public.member_role() = 'mentor';

grant select on public.pending_users to authenticated;
