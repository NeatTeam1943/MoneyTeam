# budget-alerts

Emails people about budgets that have gone over, or are approaching their
ceiling. Runs on a schedule; nothing in the app triggers it.

## Deploying

    supabase functions deploy budget-alerts

## Secrets

    supabase secrets set RESEND_API_KEY=re_xxx
    supabase secrets set ALERT_FROM="MoneyTeam <alerts@yourdomain>"

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.

**Without `RESEND_API_KEY` the function still runs** and logs what it would
have sent instead of sending it. That is deliberate: you can deploy and watch
it decide correctly for a few days before any email reaches anyone.

## Scheduling

In the Supabase dashboard, Database → Cron:

    select cron.schedule(
      'budget-alerts-daily',
      '0 6 * * *',                       -- 06:00 UTC
      $$select net.http_post(
          url := 'https://<project>.supabase.co/functions/v1/budget-alerts',
          headers := '{"Authorization": "Bearer <service-role-key>"}'::jsonb
        )$$
    );

Daily is the right cadence. Hourly would mean a purchase made at lunch produces
an email before anyone has had a chance to correct a typo in it — and since each
overspend is only reported once, running more often buys nothing except a
narrower window between the overspend and the email.

## One email per overspend

A budget crossing its ceiling is a single EVENT and is reported once. While it
stays over, nothing further is sent — however much it grows.

    day 1   over by 6,387    sent
    day 2   over by 6,387    silent
    day 4   over by 7,500    silent  <- grew, still silent
    day 12  raise approved, back under    state cleared
    day 20  over by 400      sent    <- a NEW event

`alert_state` holds one row per member+budget with an `active` flag. That flag
is the whole mechanism: while it is true, nothing more is sent.

Clearing it when a budget comes back under matters as much as setting it.
Without that, a budget that goes over, gets a raise, and later goes over again
would stay silent forever — the second overspend is a real event and has to be
reported.

`min_amount` is purely a floor: below it, an overspend is not worth an email at
all. It is not a "tell me again once it grows by this much", because there is no
telling again.

## Why the SQL view

The function does not decide what "over budget" means — `budget_alert_candidates`
does, in the database, using the same figures the app uses. A second definition
written in TypeScript would drift from the first, and the alert is the copy
nobody can debug when the two disagree.

## Failure handling

`alert_state` is written only after a send succeeds, so a failed email is retried
on the next run rather than being silently recorded as delivered. A missing API
key logs and continues rather than aborting the run for everyone.
