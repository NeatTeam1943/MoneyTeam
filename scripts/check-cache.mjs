// The cache's contract, asserted rather than assumed.
//
// A cache that serves stale data after a write is exactly the drift I refused
// to accept for stored balances, so it is checked the same way: with a fake
// client that counts network calls.
//
// Run: bash scripts/check-cache.sh
// Exercises the cache's contract with a fake supabase.
let calls = 0
const fake = {
  from: (table) => ({
    select: () => ({ eq: async () => { calls++; return { data: [{ table, n: calls }], error: null } } }),
    insert: async () => ({ error: null }),
    update: () => ({ eq: async () => ({ error: null }) }),
  }),
}
const mod = await import('/tmp/cache.mjs')
mod.__setClient(fake)
const { fetchCached, mutate, invalidate } = mod

let fails = 0
const check = (label, got, want) => {
  const ok = got === want
  if (!ok) fails++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} got ${got}  want ${want}`)
}

calls = 0
await fetchCached('budgets', { seasonId: 'S1' })
await fetchCached('budgets', { seasonId: 'S1' })
await fetchCached('budgets', { seasonId: 'S1' })
check('three reads of one season hit the network once', calls, 1)

await fetchCached('budgets', { seasonId: 'S2' })
check('a different season is fetched separately', calls, 2)

// the contract that matters
await mutate('budgets', (q) => q.insert({}))
await fetchCached('budgets', { seasonId: 'S1' })
check('a write forces the next read to refetch', calls, 3)

await fetchCached('shopping_items', { seasonId: 'S1' })
const before = calls
await mutate('budgets', (q) => q.insert({}))
await fetchCached('shopping_items', { seasonId: 'S1' })
check('writing budgets does NOT evict shopping_items', calls, before)

invalidate()
await fetchCached('budgets', { seasonId: 'S1' })
check('a bare invalidate clears everything', calls, before + 1)

console.log(`\n  ${fails} failure(s)`)
process.exit(fails ? 1 : 0)
