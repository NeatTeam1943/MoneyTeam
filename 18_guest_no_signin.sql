-- ============================================================================
--  Migration 18 — parent view with no sign-in at all.
--
--  Replaces the approach in migration 16. That version used Supabase anonymous
--  sign-in, which turns out to be the wrong tool: an anonymous sign-in creates
--  a real row in auth.users and counts as a Monthly Active User, and Supabase
--  has no automatic cleanup for them. Every parent opening the link would have
--  cost one MAU and left a permanent row — and defending that with a CAPTCHA
--  only slows the bleeding, it does not stop it.
--
--  A parent needs no identity. They are not writing anything and there is
--  nothing to personalise. So they simply do not sign in: the browser talks to
--  PostgREST as the built-in `anon` role using the public key that is already
--  in the bundle. No auth event, therefore no MAU, no auth.users row, and
--  nothing for a bot to inflate — hitting the endpoint a million times creates
--  exactly zero records.
--
--  Every table in public has RLS enabled (verified), so `anon` can read
--  strictly what is granted below and nothing else. There are no INSERT,
--  UPDATE or DELETE policies for anon anywhere, so this is read-only by
--  construction, not by convention.
--
--  BE CLEAR ABOUT WHAT THIS MEANS: the parent view is genuinely public. Anyone
--  who opens the site can read the ledger and balances. That was already true
--  with anonymous sign-in — the button was right there on the login screen —
--  so this is not a new exposure, but it is worth saying plainly. If the
--  finances should not be world-readable, this feature needs a shared secret
--  rather than an open view, and that is a different design.
--
--  Run after 16. Re-runnable. Safe to run while 16's anonymous path still
--  exists; both are accepted during the changeover.
-- ============================================================================

-- A guest is now "a request with no logged-in user", i.e. PostgREST running as
-- the anon role. The is_anonymous branch is kept so any parent still holding an
-- anonymous session from migration 16 does not get locked out mid-session.
-- Reads the claims through current_setting rather than auth.jwt(), so it needs
-- no privileges on the auth schema — the anon role may not have them, and a
-- SQL function gets inlined, which means the OR does NOT reliably short-circuit
-- past a call it cannot make. Left as SECURITY INVOKER on purpose: a definer
-- function would run as the owner and current_user would stop being 'anon'.
create or replace function public.is_guest()
returns boolean
language sql
stable
as $$
  select current_user = 'anon'
      or coalesce(
           (nullif(current_setting('request.jwt.claims', true), '')::jsonb
             ->> 'is_anonymous')::boolean,
           false);
$$;

grant execute on function public.is_guest()         to anon, authenticated;
grant execute on function public.can_view_public()  to anon, authenticated;
grant execute on function public.member_role()      to anon, authenticated;

grant usage on schema public to anon;

-- The two censored views, and nothing else.
grant select on public.transactions_guest      to anon;
grant select on public.account_balances_guest  to anon;

-- Reference labels needed to render those two screens. The policies from
-- migration 16 have no TO clause, so they already apply to anon; these grants
-- are what actually let the role reach the tables.
grant select on public.seasons        to anon;
grant select on public.accounts       to anon;
grant select on public.categories     to anon;
grant select on public.income_sources to anon;

-- Explicitly keep everything else shut, in case a future default grant is
-- looser than expected. Revoking is cheap and makes the intent auditable.
revoke all on public.transactions      from anon;
revoke all on public.transaction_lines from anon;
revoke all on public.budgets           from anon;
revoke all on public.shopping_items    from anon;
revoke all on public.shopping_templates from anon;
revoke all on public.priority_levels   from anon;
revoke all on public.vendors           from anon;
revoke all on public.members           from anon;
revoke all on public.account_balances  from anon;
revoke all on public.transactions_view from anon;

-- No writes for anon, anywhere, ever.
revoke insert, update, delete on all tables in schema public from anon;
