// Overspend alerts. One email per overspend — never a daily reminder.
//
// A budget crossing its ceiling is a single EVENT and is reported once. While
// it stays over, nothing further is sent, however much it grows. A second email
// is only ever sent if the budget came back under and crossed again, which is a
// new event rather than a continuation.
//
// That is the whole point of `alert_state`: one row per member+budget holding
// whether we are currently inside a reported overspend. An inbox that repeats
// itself is one people filter, and a filtered alert looks exactly like a
// working one right up until the day it matters.
//
// The function does not decide what "over budget" means — the
// `budget_alert_candidates` view does, using the same figures the app uses. A
// second definition here would drift from the SQL one.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = Deno.env.get('ALERT_FROM') ?? 'MoneyTeam <onboarding@resend.dev>'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://neatteam1943.github.io/MoneyTeam'

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const ils = (n: number) =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(Number(n) || 0)
const day = (d: string) =>
  new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(d))

type Line = { date: string; amount: number; description: string | null; vendor: string | null }
type Candidate = {
  budget_id: string
  season_id: string | null
  season_name: string | null
  budget_name: string
  team_scope: string
  amount: number
  spent: number
  over_by: number
  pct: number | null
  line_count: number
  recent_lines: Line[] | null
}

const scopeLabel = (s: string) =>
  s === 'frc' ? 'FRC' : s === 'ftc' ? 'FTC' : 'משותף'

/**
 * The email.
 *
 * Written to be actionable on a phone lock screen: the budget, by how much, and
 * what the last purchases against it were. A message that only says "a budget
 * is over" makes the reader open the app to learn anything, which is the same
 * as not telling them.
 */
function emailHtml(c: Candidate) {
  const rows = (c.recent_lines ?? []).map((l) => `
    <tr>
      <td style="padding:6px 10px;color:#666;font-size:13px;white-space:nowrap">${day(l.date)}</td>
      <td style="padding:6px 10px;font-size:13px">${l.description ?? l.vendor ?? '—'}</td>
      <td style="padding:6px 10px;font-size:13px;text-align:left;font-family:ui-monospace,monospace;white-space:nowrap">${ils(l.amount)}</td>
    </tr>`).join('')

  const pct = c.pct == null ? '' : `${Math.round(c.pct)}%`

  return `<!doctype html>
<html dir="rtl" lang="he">
<body style="margin:0;padding:24px;background:#eef1f8;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">

    <div style="background:#0522d6;padding:18px 22px">
      <div style="color:#fff;font-size:13px;letter-spacing:.08em;opacity:.85">NEAT TEAM 1943</div>
      <div style="color:#fff;font-size:20px;font-weight:700;margin-top:2px">חריגה מתקציב</div>
    </div>

    <div style="padding:22px">
      <div style="font-size:17px;font-weight:700;margin-bottom:2px">
        ${c.budget_name} · ${scopeLabel(c.team_scope)}
      </div>
      <div style="color:#666;font-size:13px;margin-bottom:16px">${c.season_name ?? ''}</div>

      <!-- The number first: this is what the alert exists to say. -->
      <div style="background:#fff5f5;border-inline-start:4px solid #e0384c;border-radius:8px;padding:14px 16px;margin-bottom:18px">
        <div style="color:#e0384c;font-size:26px;font-weight:700;font-family:ui-monospace,monospace">
          ${ils(c.over_by)}
        </div>
        <div style="color:#666;font-size:13px;margin-top:2px">מעל התקציב</div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
        <tr>
          <td style="padding:6px 0;color:#666;font-size:14px">תקציב</td>
          <td style="padding:6px 0;text-align:left;font-family:ui-monospace,monospace;font-size:14px">${ils(c.amount)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#666;font-size:14px">נוצל</td>
          <td style="padding:6px 0;text-align:left;font-family:ui-monospace,monospace;font-size:14px">${ils(c.spent)} ${pct ? `<span style="color:#999">(${pct})</span>` : ''}</td>
        </tr>
      </table>

      ${rows ? `
      <div style="font-size:13px;color:#666;font-weight:600;margin-bottom:6px">ההוצאות האחרונות בתקציב</div>
      <table style="width:100%;border-collapse:collapse;background:#f7f8fc;border-radius:8px;overflow:hidden">
        ${rows}
      </table>` : ''}

      <div style="margin-top:22px">
        <a href="${APP_URL}/#/budgets"
           style="display:inline-block;background:#ff9100;color:#000;text-decoration:none;
                  padding:11px 20px;border-radius:8px;font-weight:700;font-size:14px">
          פתיחת התקציבים
        </a>
      </div>

      <!-- Says plainly that this will not repeat, so nobody wonders whether to
           expect a daily reminder — or worse, assumes silence means resolved. -->
      <p style="color:#999;font-size:12px;line-height:1.7;margin:20px 0 0;border-top:1px solid #eee;padding-top:14px">
        התראה זו נשלחת פעם אחת בלבד עבור החריגה הזו — לא יישלחו תזכורות.<br>
        אפשר לכבות התראות בהגדרות ← התראות.
      </p>
    </div>
  </div>
</body>
</html>`
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_KEY) {
    // No key: log and carry on. A missing key must not stop the state being
    // updated for everyone else, and it lets the function be watched for a few
    // days before any mail actually goes out.
    console.log(`[dry-run] ${to}: ${subject}`)
    return true
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })
  if (!res.ok) {
    console.error(`email to ${to} failed: ${res.status} ${await res.text()}`)
    return false
  }
  return true
}

Deno.serve(async () => {
  const started = Date.now()

  const [{ data: prefs, error: e1 }, { data: cands, error: e2 }, { data: state, error: e3 }] =
    await Promise.all([
      db.from('alert_preferences').select('*').eq('overspend', true),
      db.from('budget_alert_candidates').select('*'),
      db.from('alert_state').select('*'),
    ])

  if (e1 || e2 || e3) {
    return new Response(JSON.stringify({ error: e1?.message ?? e2?.message ?? e3?.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const candidates = (cands ?? []) as Candidate[]
  const byBudget = new Map(candidates.map((c) => [c.budget_id, c]))
  const stateKey = (m: string, b: string) => `${m}|${b}`
  const seen = new Map((state ?? []).map((s) => [stateKey(s.member_id, s.budget_id), s]))

  const { data: members } = await db.from('members').select('id,email')
  const emailOf = new Map((members ?? []).map((m) => [m.id, m.email]))

  let sent = 0
  let cleared = 0

  for (const p of prefs ?? []) {
    const to = emailOf.get(p.member_id)
    if (!to) continue
    const floor = Number(p.min_amount ?? 0)

    for (const c of candidates) {
      const key = stateKey(p.member_id, c.budget_id)
      const prev = seen.get(key)
      const isOver = c.over_by > 0 && c.over_by >= floor

      // Back under the ceiling: forget it, so a future crossing is a NEW event
      // and will be reported again. Without this, a budget that goes over,
      // gets a raise, and later goes over again would stay silent forever.
      if (!isOver) {
        if (prev?.active) {
          await db.from('alert_state').upsert({
            member_id: p.member_id, budget_id: c.budget_id,
            active: false, cleared_at: new Date().toISOString(),
          }, { onConflict: 'member_id,budget_id' })
          cleared++
        }
        continue
      }

      // Already reported and still over: silence. This is the anti-spam rule.
      if (prev?.active) continue

      const ok = await sendEmail(
        to,
        `MoneyTeam — חריגה: ${c.budget_name} ${ils(c.over_by)}`,
        emailHtml(c),
      )
      if (!ok) continue

      // Written only after a successful send, so a failed email is retried on
      // the next run rather than silently marked as delivered.
      await db.from('alert_state').upsert({
        member_id: p.member_id,
        budget_id: c.budget_id,
        active: true,
        first_over_by: c.over_by,
        notified_at: new Date().toISOString(),
        cleared_at: null,
      }, { onConflict: 'member_id,budget_id' })
      sent++
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, cleared, ms: Date.now() - started }),
    { headers: { 'Content-Type': 'application/json' } })
})
