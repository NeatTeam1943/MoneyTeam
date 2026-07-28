# Verification scripts

## golden-master-budgets.mjs

Pins the budget arithmetic. Holds a verbatim copy of the ORIGINAL inline
implementation from `Budgets.jsx` and runs it beside the extracted
`src/domain/budgets.js` over every grouping × program-filter combination,
asserting byte-identical JSON.

This is what makes "refactored without changing behaviour" checkable rather
than asserted. Keep the reference copy frozen: if a real behaviour change is
ever wanted, change the reference in the same commit and say so explicitly.

```bash
# 1. export a dataset (any Postgres copy of the schema)
psql -At -o /tmp/gm.json -c "select json_build_object(
  'budgets',(select coalesce(json_agg(row_to_json(b)),'[]') from (select id,category_id,amount,team_scope from budgets) b),
  'lines',(select coalesce(json_agg(row_to_json(l)),'[]') from (select budget_id,amount,team_scope from transaction_lines) l),
  'shopping',(select coalesce(json_agg(row_to_json(s)),'[]') from (select category_id,status,est_price,quantity,team_scope from shopping_items) s),
  'cats',(select coalesce(json_agg(row_to_json(c)),'[]') from (select id,name,parent_id from categories) c))"

# 2. bundle the module (plain Node will not resolve extensionless imports)
npx esbuild src/domain/budgets.js --bundle --format=esm --outfile=/tmp/budgets.bundle.mjs

# 3. run
node scripts/golden-master-budgets.mjs      # exit 0 = identical
```

## Linting

ESLint silently skips an entire file when an inline comment names a rule it
does not know, and this project has `eslint-disable-line react-hooks/…`
comments without the plugin installed. Always pass `--no-inline-config`:

```bash
npx eslint --no-inline-config --rule '{"no-undef":"error"}' --ext .js,.jsx src/
```
