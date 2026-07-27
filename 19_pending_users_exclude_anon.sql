-- ============================================================================
--  Migration 19 — anonymous users are not people waiting for approval.
--
--  Symptom: the mentor screen says a user is pending, but the row underneath
--  is blank and there is nobody to approve.
--
--  Cause, and it is mine: migration 16 implemented the parent view with
--  Supabase anonymous sign-in. Every tap of the parent button created a real
--  auth.users row with no email, no name, and no members row. pending_users
--  is defined as "an auth user with no members row", so those rows land in the
--  pending list. The UI prints `full_name || email` — both null — so it draws
--  an empty label next to a Grant access button, while the count still says 1.
--
--  Migration 18 already removed the cause (parents no longer sign in at all).
--  This removes the leftovers from the list, and stops anonymous sessions
--  appearing there if one is ever created again.
--
--  Run after 12. Independent of 13-18 — safe to run at any point.
-- ============================================================================

-- is_anonymous has existed on auth.users since anonymous sign-ins shipped, but
-- the view is built conditionally so this migration cannot fail on a project
-- where the column is absent.
do $$
declare
  v_has_col boolean;
  v_filter  text := '';
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'is_anonymous'
  ) into v_has_col;

  if v_has_col then
    v_filter := ' and coalesce(u.is_anonymous, false) = false';
  else
    raise notice 'auth.users.is_anonymous not present — skipping the anonymous filter';
  end if;

  execute 'drop view if exists public.pending_users';
  execute format($v$
    create view public.pending_users as
    select
      u.id,
      u.email,
      u.raw_user_meta_data ->> 'full_name' as full_name,
      u.created_at
    from auth.users u
    where not exists (select 1 from public.members m where m.id = u.id)
      %s
      and public.member_role() = 'mentor'
  $v$, v_filter);

  execute 'grant select on public.pending_users to authenticated';
end $$;


-- ----------------------------------------------------------------------------
--  OPTIONAL CLEANUP — read before running.
--
--  The anonymous rows already created are inert now: they are excluded from
--  the pending list, they cannot sign in to anything, and nothing references
--  them. They do still sit in auth.users, and each one counted as a Monthly
--  Active User in the cycle it was created.
--
--  Run this SELECT first to see exactly what exists:
--
--     select id, created_at from auth.users where coalesce(is_anonymous,false);
--
--  If — and only if — every row it returns is a stray parent-button session,
--  the DELETE below removes them. It is irreversible, so it is left commented
--  out deliberately; uncomment and run it yourself once you have looked.
--
--     delete from auth.users
--      where coalesce(is_anonymous, false)
--        and not exists (select 1 from public.members m where m.id = auth.users.id);
--
--  Deleting them does NOT refund the MAU already counted for the current
--  billing cycle; it only stops the rows accumulating.
-- ----------------------------------------------------------------------------
