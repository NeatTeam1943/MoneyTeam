-- ============================================================================
--  Migration 52 — a reason, and a history, for changes that send a request
--  backwards.
--
--  One file, no enum values, safe to re-run.
-- ============================================================================

-- 1) Which priority levels demand an explanation -----------------------------
--
-- The team uses priority levels as a workflow marker, not only as urgency:
-- "WIP" and "להשלים מידה/כמות" mean "this came back to you, fix it". Moving an
-- item there should say why, while bumping something from "נחמד שיהיה" to
-- "קריטי" should not nag.
--
-- Which levels mean that is the team's business, not the code's, so it is a
-- flag on the row rather than a list of names compiled into the app. A Hebrew
-- name matched in JavaScript would break the first time someone renamed a
-- level or added another one.
alter table public.priority_levels
  add column if not exists requires_reason boolean not null default false;

comment on column public.priority_levels.requires_reason is
  'Moving an item TO this level opens the "why?" box. Set it on the levels that
   mean "needs work" rather than "urgent" — WIP, missing measurements — and
   leave it off for ordinary urgency.';

-- 2) The history ------------------------------------------------------------
--
-- Kept as its own table rather than a column on the item: an item can go back
-- and forth several times, and the point is to be able to read what happened,
-- not only the latest note. Nothing is ever updated here — a row is what
-- somebody said at the time, so it stays as written.
create table if not exists public.shopping_change_notes (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.shopping_items(id) on delete cascade,
  -- 'status' or 'priority'. Plain text rather than an enum: this is a label on
  -- a log line, and a new kind of change should not need a migration.
  field       text not null,
  from_value  text,
  to_value    text,
  note        text not null,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists ix_change_notes_item
  on public.shopping_change_notes(item_id, created_at desc);

comment on table public.shopping_change_notes is
  'Why a shopping item was sent back, cancelled or parked. Append-only: rows
   are not edited or deleted, because a note is a record of what someone said
   at the time. Shown on the item, not in the main list.';

alter table public.shopping_change_notes enable row level security;
alter table public.shopping_change_notes force  row level security;

drop policy if exists change_notes_read   on public.shopping_change_notes;
drop policy if exists change_notes_insert on public.shopping_change_notes;
drop policy if exists change_notes_write  on public.shopping_change_notes;

-- Any member may read them: the person whose request came back is usually a
-- student, and a reason nobody can read is not a reason.
create policy change_notes_read on public.shopping_change_notes
  for select using (public.member_role() is not null);

-- Written by whoever may actually make the change the note is about — mentors
-- and the finance lead. created_by is forced to the caller so a note cannot be
-- filed under someone else's name.
create policy change_notes_insert on public.shopping_change_notes
  for insert with check (
    (public.member_role() = 'mentor' or public.is_finance_lead())
    and created_by = auth.uid()
  );

-- No update, no delete policy, deliberately: with RLS forced and no policy,
-- both are refused for everyone. The history is append-only.

-- Verify:
--   select name, requires_reason from public.priority_levels order by rank;
--   select * from public.shopping_change_notes order by created_at desc limit 5;
