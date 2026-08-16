-- ============================================================================
--  Migration 41 — who gets told about an overspend, and what has been told.
--
--  ONE EMAIL PER OVERSPEND. Not one per day while it lasts, not one per time it
--  grows: a budget crossing its ceiling is a single event, and it is reported
--  once. An inbox that repeats itself is an inbox people filter, and a filtered
--  alert looks exactly like a working one until the day it matters.
--
--  A second email is only ever sent if the budget came back UNDER its ceiling
--  and then crossed again — that is a new event, not a continuation.
--
--  That rule lives in `alert_state` below, which holds one row per
--  member+budget and remembers whether we are currently inside an overspend.
--
--  PERMISSIONS: anyone switches their OWN alerts; only mentors change someone
--  else's. Silencing your own email is not a finance decision.
--
--  Re-runnable.
-- ============================================================================

create table if not exists public.alert_preferences (
  member_id     uuid primary key references public.members(id) on delete cascade,
  overspend     boolean not null default false,
  -- Below this, an overspend is not worth an email at all. It is a floor for
  -- sending, NOT a "tell me again once it grows by this much" — there is no
  -- telling again.
  min_amount    numeric(12,2) not null default 0 check (min_amount >= 0),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.members(id) on delete set null
);

-- One row per member+budget. `active` is the whole anti-spam mechanism: while
-- true, this overspend has already been reported and nothing more is sent.
create table if not exists public.alert_state (
  member_id     uuid not null references public.members(id) on delete cascade,
  budget_id     uuid not null references public.budgets(id) on delete cascade,
  active        boolean not null default false,
  first_over_by numeric(12,2),
  notified_at   timestamptz,
  cleared_at    timestamptz,
  primary key (member_id, budget_id)
);

create index if not exists ix_alert_state_active
  on public.alert_state (member_id) where active;

alter table public.alert_preferences enable row level security;
alter table public.alert_preferences force row level security;
alter table public.alert_state enable row level security;
alter table public.alert_state force row level security;

drop policy if exists alert_prefs_read on public.alert_preferences;
create policy alert_prefs_read on public.alert_preferences for select
  using (public.member_role() is not null);

drop policy if exists alert_prefs_write on public.alert_preferences;
create policy alert_prefs_write on public.alert_preferences for insert
  with check (member_id = auth.uid() or public.member_role() = 'mentor');

drop policy if exists alert_prefs_update on public.alert_preferences;
create policy alert_prefs_update on public.alert_preferences for update
  using (member_id = auth.uid() or public.member_role() = 'mentor')
  with check (member_id = auth.uid() or public.member_role() = 'mentor');

drop policy if exists alert_prefs_delete on public.alert_preferences;
create policy alert_prefs_delete on public.alert_preferences for delete
  using (member_id = auth.uid() or public.member_role() = 'mentor');

drop policy if exists alert_state_read on public.alert_state;
create policy alert_state_read on public.alert_state for select
  using (member_id = auth.uid() or public.member_role() = 'mentor');

grant select, insert, update, delete on public.alert_preferences to authenticated;
grant select on public.alert_state to authenticated;

-- ----------------------------------------------------------------------------
-- What the job needs, with enough detail for the email to be worth reading.
--
-- A view rather than logic in the function: "over budget" is already defined in
-- this database, and an Edge Function re-deriving it in TypeScript is a second
-- implementation that will drift. If the app and the alert ever disagree, the
-- alert is the copy nobody can debug.
create or replace view public.budget_alert_candidates as
with spend as (
  select l.budget_id, sum(l.amount) as spent, count(*) as line_count
    from public.transaction_lines l
    join public.transactions t on t.id = l.transaction_id
   where t.approval = 'approved'
   group by l.budget_id
),
recent as (
  -- The purchases that pushed it over, so the email can say WHAT happened
  -- rather than only that something did.
  select
    l.budget_id,
    jsonb_agg(jsonb_build_object(
      'date', t.date,
      'amount', l.amount,
      'description', coalesce(nullif(l.description, ''), t.description, t.vendor),
      'vendor', t.vendor
    ) order by t.date desc) filter (where rn <= 3) as latest
  from (
    select l.*, t.id as tx, row_number() over (partition by l.budget_id order by t.date desc) as rn
      from public.transaction_lines l
      join public.transactions t on t.id = l.transaction_id
     where t.approval = 'approved'
  ) l
  join public.transactions t on t.id = l.tx
  group by l.budget_id
)
select
  b.id            as budget_id,
  b.season_id,
  s2.name         as season_name,
  b.team_scope,
  coalesce(c.name, 'כללי') as budget_name,
  b.amount,
  coalesce(sp.spent, 0)                as spent,
  coalesce(sp.spent, 0) - b.amount     as over_by,
  case when b.amount > 0 then round(coalesce(sp.spent, 0) / b.amount * 100, 2) end as pct,
  coalesce(sp.line_count, 0)           as line_count,
  r.latest                             as recent_lines
from public.budgets b
left join spend sp on sp.budget_id = b.id
left join recent r on r.budget_id = b.id
left join public.categories c on c.id = b.category_id
left join public.seasons s2 on s2.id = b.season_id
where b.amount > 0;

grant select on public.budget_alert_candidates to authenticated;
