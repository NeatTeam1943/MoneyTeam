-- ============================================================================
--  Migration 42 — alert only on ACTIVE seasons, and name the season.
--
--  Two faults in the alert view from migration 41:
--
--    1. It considered every budget in every season. A budget that went over in
--       2026 would produce an email today, about a season that is finished and
--       that nobody can act on. Worse, it would arrive looking exactly like a
--       live problem.
--
--    2. The season was in the view but the email never said which one. On a
--       team running FRC and FTC across overlapping seasons, "רובוט is over by
--       6,387" is ambiguous — the first question is always "which season".
--
--  Fixed in the VIEW rather than in the sending script, so the definition of
--  "worth alerting about" stays in one place. A script that filtered seasons
--  itself would be a second definition, and the two would drift.
--
--  Re-runnable.
-- ============================================================================

create or replace view public.budget_alert_candidates as
with spend as (
  select l.budget_id, sum(l.amount) as spent, count(*) as line_count
    from public.transaction_lines l
    join public.transactions t on t.id = l.transaction_id
   where t.approval = 'approved'
   group by l.budget_id
),
recent as (
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
  s.name          as season_name,
  b.team_scope,
  coalesce(c.name, 'כללי') as budget_name,
  b.amount,
  coalesce(sp.spent, 0)            as spent,
  coalesce(sp.spent, 0) - b.amount as over_by,
  case when b.amount > 0 then round(coalesce(sp.spent, 0) / b.amount * 100, 2) end as pct,
  coalesce(sp.line_count, 0)       as line_count,
  r.latest                         as recent_lines
from public.budgets b
-- INNER join, not LEFT: a budget with no season cannot be judged as current,
-- and silence is the right answer for something nobody can act on.
join public.seasons s on s.id = b.season_id and s.is_active
left join spend sp on sp.budget_id = b.id
left join recent r on r.budget_id = b.id
left join public.categories c on c.id = b.category_id
where b.amount > 0;

grant select on public.budget_alert_candidates to authenticated;
