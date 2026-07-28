# MoneyTeam — Neat Team 1943 Finance

Money management for **FIRST Team 1943**: ledger, budgets, purchasing, shopping
lists, reporting and what-if planning for **two competition programs (FRC and
FTC) run out of one set of accounts**.

React + Vite front end, Supabase back end, deployed free to GitHub Pages.
Hebrew-first (RTL) with a complete English translation.

**Live:** https://neatteam1943.github.io/MoneyTeam/

---

## Why this exists

One bank account, one set of sponsors, two programs. Some money is shared, most
is not, and a single supplier order routinely contains FRC parts, FTC parts and
shared consumables on the same receipt.

A spreadsheet cannot express that without lying about it. That constraint drives
most of the design — see [Program scoping](#program-scoping-frc--ftc), which is
the most important section here.

---

## What it does

- **Ledger** — four transaction types: income, expense, transfer, and **in-kind**
  (a sponsor buying you something: counts toward that sponsor's contribution and
  the category acquired, but never touches a cash account).
- **Split purchases** — one expense, many lines. Each line has its own budget,
  amount, description, currency and program.
- **Accounts as buckets** — bank, school-held, store credit, city fund, cash.
  Store credit fills from income (sponsor) or a transfer (bank).
- **Per season**, with full history. Nothing is deleted; everything filters by season.
- **Dashboard** — income/expense by month, spend by category, income by source,
  live balances, budget overrun.
- **Transactions** — filter by type / account / category / source / date, search,
  sort, per-row program badges, totals footer.
- **Budgets** — per season, per category, **per program**, with burn-down bars.
- **Shopping list** — links, מק״ט (SKU), custom priority levels, status, search,
  bulk status changes, and typed **templates** (text / number / single choice /
  multiple choice). A **Buy** action turns selected items straight into an
  expense and links them back.
- **Reports** — any period (month / quarter / year / season / custom): income vs
  expense, cumulative net, by category, vendor, source, account and program.
- **Simulation** — what-if planner. Pick wish-list items, add ad-hoc rows and
  expected income, choose a funding account per row, and see which accounts go
  negative and which budgets newly bust. Writes nothing.
- **Excel export** of exactly what is on screen, with a provenance sheet.
- **Receipts** in private storage, previewed inline (image and PDF), downloadable
  as a ZIP archive with an index.

---

## Stack

| | |
|---|---|
| Frontend | React 18 + Vite, `react-router-dom` (**HashRouter** — needed for Pages deep links) |
| Charts | Recharts |
| Backend | Supabase — Postgres, Auth (Google OAuth), Storage |
| Exports | SheetJS (`xlsx`), JSZip |
| Hosting | GitHub Pages via `.github/workflows/deploy.yml` (Node 20, on push to `main`) |

`vite.config.js` sets `base: './'` so assets stay relative and the build works
from any project subpath.

---

## Setup

### 1. Supabase

1. Create a project. Authentication → Providers → enable **Google**.
2. Run the SQL migrations **in numeric order** in the SQL editor (see below).
3. Create your auth user by signing in once, then insert a `members` row with
   your UID and role `mentor` — the bootstrap insert is at the bottom of
   `01_foundation.sql`.

### 2. Local

```bash
npm install
# .env.local
#   VITE_SUPABASE_URL=https://<project>.supabase.co
#   VITE_SUPABASE_ANON_KEY=<anon key>
npm run dev
```

`npm run build` → `dist/`. `npm run preview` serves the build.

### 3. Deploy

1. Repo → Settings → Secrets and variables → Actions → add `VITE_SUPABASE_URL`
   and `VITE_SUPABASE_ANON_KEY`. The workflow injects them at build time.
2. Repo → Settings → Pages → Source = **GitHub Actions**.
3. Push to `main`. It builds and publishes itself.

> The anon key ships in the client bundle — that is expected. RLS is the only
> wall. Never put the service-role key in this project.

---

## Database

Migrations are plain SQL applied in numeric order. They are cumulative and every
one is **re-runnable** — `if not exists`, `create or replace`, `drop … if exists`,
existence checks before inserts.

| | |
|---|---|
| `01`–`12` | Foundation: seasons, accounts, categories, transactions, budgets, shopping list, receipts, roles, pending users |
| `13` | `team_scope` enum + column on categories, shopping items, transactions |
| `14` | One-off import of the 2027 shopping list |
| `15` | FX currency/rate persisted on expense lines |
| `16` | Column-censored views for the parent view |
| `17` | `team_scope` per **transaction line** |
| `18` | Parent view via the `anon` role — no sign-in, no MAU |
| `19` | Keep anonymous users out of the pending-approval list |
| `20` | Budgets own their program; cross-program charging blocked by trigger |

**Tables:** `seasons` · `accounts` · `categories` (self-referencing tree) ·
`budgets` · `transactions` · `transaction_lines` · `shopping_items` ·
`shopping_templates` · `income_sources` · `vendors` · `priority_levels` · `members`

**Enums:**
`member_role` = mentor · editor · viewer · student ·
`transaction_type` = income · expense · transfer · in_kind ·
`shopping_status` = wish · pending_approval · approved · ordered · received · cancelled ·
`team_scope` = frc · ftc · both

**Expenses go through the `save_expense()` RPC**, not a direct insert, so the
header total, the lines, the FX breadcrumb, the derived program and any linked
shopping items all move together in one transaction.

`account_balances` is a DB view (all-time, in-kind excluded). Season net is
computed client-side.

---

## Program scoping (FRC / FTC)

Every markable row carries `team_scope`: `frc`, `ftc` or `both`. A `both` row
**always** matches whichever program is being viewed — that is what shared means.
A checklist in the top bar filters the whole app at once.

Three rules govern it. Breaking any of them produces numbers that quietly lie.

**1. Money is attributed by LINE, never by header.**
One receipt can hold all three kinds, so its header becomes `both` — true of the
purchase, useless as an accounting fact. `src/lib/teamScope.js` re-attributes:
a ₪28,139 receipt shows ₪16,169 under an FRC filter. Rows with no lines (income,
transfers, in-kind) keep header semantics, because that is all the information
that exists about them.

**2. The filter chooses which budgets you see — never how full they are.**
A shared pot drained by FTC has that much less in it whether or not you are
looking at FTC. Its consumed figure is therefore never filtered; doing so would
report a remaining balance larger than the money that exists. Shared pots show a
secondary line breaking down who spent what.

**3. What cannot be computed honestly is withheld.**
Income and bank balances are shared and are not split by program. Under a partial
filter income arrives in full while expenses are narrowed, so **Net shows `—`**
rather than a confidently wrong and always flattering number. `ScopeNotice`
explains this on screen whenever a filter is active.

The database enforces separation too: `guard_line_budget_scope()` refuses to
charge an FRC line to an FTC budget. Anything involving `both` is allowed in
either direction.

**Colours:** FRC blue `#1100ff` + orange accent (the main team, and the palette
the app is built on). FTC red `#c8102e` + white. The FTC red is kept deliberately
distinct from `--danger`, and program badges use a solid fill while warnings use
tinted text, so a red pill never reads as "overspent".

---

## Roles and access

| Role | Can |
|---|---|
| `mentor` | Everything: settings, budgets, approvals, status changes, payer names |
| `editor` | Create and edit transactions and shopping items |
| `student` | Read, and add shopping requests; payer names show as `***` |
| `viewer` | Read only |
| *parent* | **Not a role** — see below |

New Google sign-ins land with no `members` row and see a pending-approval screen
until a mentor grants access.

### The parent view

Parents get the dashboard and the ledger, read-only, with payer names, receipts
and notes removed — **and they do not sign in at all.**

An earlier version used Supabase anonymous sign-in. That was the wrong tool:
every visit created a real `auth.users` row and counted as a Monthly Active User,
with no automatic cleanup. Instead the browser talks to PostgREST as the built-in
`anon` role using the public key already in the bundle. No auth event, so no MAU,
no rows, and nothing for a bot to inflate — which is also why no CAPTCHA is
needed.

Guests read two `security definer` views, `transactions_guest` and
`account_balances_guest`, which physically omit `payer_name`, `notes`,
`receipt_url` and `created_by`. They are deliberately **not** given a policy on
`transactions` itself, because RLS filters rows, not columns. The views carry
their own membership test, so bypassing the base table's RLS does not also bypass
the pending-approval gate.

> **The parent view is genuinely public.** Anyone who opens the site can read the
> ledger and balances. If that is not acceptable, this needs a shared secret
> rather than an open view.

---

## Layout

```
src/
  pages/         Dashboard · Transactions · Budgets · Shopping · Reports
                 Simulation · Settings · Login · NameSetup
                 AcceptInvite  (dead — no route)
  components/    TransactionForm · ShoppingForm · TeamScope · ScopeNotice
                 ReceiptPreview · CurrencyAmountInput · Modal · SimpleCrud …
  context/       Auth · Season · Lookups · TeamScope
  lib/           supabase · i18n · format · export · teamScope
*.sql            migrations, applied in numeric order
```

Pages are lazy-loaded, so Recharts and SheetJS only download on the routes that
use them.

**Lookups** (accounts, categories, vendors, priority levels, templates) load
**once per sign-in** into a shared cache. Anything that edits them must call
`reload()`, or the new row will not appear in forms until a full page refresh.
Settings wires this through `onChanged`.

---

## Conventions

- **All money in ILS.** Foreign currency is entered as amount × rate, the rate
  auto-suggested from the ECB daily reference (Frankfurter). An existing rate is
  never silently refreshed — on a saved purchase it is the historic rate the
  money actually changed hands at.
- **Quantity `0` means zero**, not one. `qtyOf()` in `lib/format.js` exists
  because `quantity || 1` silently costed deliberate zero-quantity wish-list rows
  as a single unit.
- **Exports carry provenance.** Every workbook opens with an `About` sheet
  recording season, programs included, whether the view was filtered, period and
  row count. A filtered file is otherwise indistinguishable from a complete one
  once saved.
- **Both languages, always.** Every `t()` key must exist in `he` and `en`; a
  missing key renders as the raw key string.

---

## Gotchas

- **Lint with `--no-inline-config`.** ESLint aborts linting an entire file when an
  inline comment names a rule it does not know, and this project has
  `eslint-disable-line react-hooks/exhaustive-deps` comments without the plugin
  installed. Those files are silently skipped — which is how an undefined
  variable once reached production.
  ```bash
  npx eslint --no-inline-config --rule '{"no-undef":"error"}' --ext .js,.jsx src/
  ```
  `npm run build` will **not** catch this; Vite does not resolve identifiers.
- **SQL before code.** Run a migration before deploying the code that depends on
  it, or every query touching the new column fails until you catch up.
- **`supabase/functions/invite_member` is orphaned.** Settings still passes
  `invite: true`, but nothing consumes it and nothing calls the function — email
  invites were replaced by Google sign-in plus mentor approval.
- **`src/pages/AcceptInvite.jsx` is dead code** — no route, and it references 7
  translation keys that do not exist. Safe to delete.
- **`i18n.jsx` has two duplicate keys**, `vendor` and `spent`. The later
  definition wins. Left alone because changing it changes visible text.