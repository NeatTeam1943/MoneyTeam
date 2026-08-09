-- ============================================================================
--  Migration 34 — students may create and edit shopping templates.
--
--  A template is a form skeleton: "screws" asks for diameter, length and head
--  type; "bearing" asks for bore and OD. The people who know which fields a
--  part needs are the students ordering it, and asking a mentor to transcribe
--  a field list is friction with no safety value behind it.
--
--  A template holds no money. It cannot spend, approve or reclassify anything;
--  the worst a bad one does is ask for an unhelpful field, which the next
--  person fixes. That is why this is a straight grant and not another approval
--  queue — a queue would cost more attention than the mistake it prevents.
--
--  Editors get it too. An editor already creates transactions, so withholding
--  form templates from them was never a deliberate boundary.
--
--  DELETING stays with mentors. Removing a template that other people are
--  using is the one action here that is disruptive and cannot be undone from
--  the UI, so it keeps a higher bar than creating or refining one.
--
--  Re-runnable.
-- ============================================================================

-- A single FOR ALL policy cannot express "anyone may write, only a mentor may
-- delete", so it is replaced with one policy per command.
drop policy if exists templates_write on public.shopping_templates;

drop policy if exists templates_insert on public.shopping_templates;
create policy templates_insert
  on public.shopping_templates for insert
  with check (public.can_propose());

drop policy if exists templates_update on public.shopping_templates;
create policy templates_update
  on public.shopping_templates for update
  using (public.can_propose())
  with check (public.can_propose());

drop policy if exists templates_delete on public.shopping_templates;
create policy templates_delete
  on public.shopping_templates for delete
  using (public.member_role() = 'mentor');

-- can_propose() is mentor/editor/student — defined in migration 26 for the
-- proposal path. Recreated here so this file stands alone if 26 has not run.
create or replace function public.can_propose()
returns boolean
language sql
stable
as $$
  select coalesce(public.member_role()::text, '') in ('mentor', 'editor', 'student');
$$;

revoke all on function public.can_propose() from public;
grant execute on function public.can_propose() to authenticated;
