/**
 * Evaluating a formula written in terms of named variables.
 *
 * "students * foodPerStudent" with students = 24 and foodPerStudent = 18.
 *
 * ── Why not eval, or new Function ───────────────────────────────────────────
 *
 * Both would run whatever is typed, with access to everything the page can
 * reach. The formulas are saved and restored, so a value that arrived from a
 * shared scenario or a stale localStorage entry would execute on load. That is
 * a real hole for a feature whose entire job is arithmetic on four operators.
 *
 * So: a tokeniser and a shunting-yard pass. It understands numbers, names,
 * + - * / ( ) and nothing else — there is no syntax for reaching anything.
 */

const OPS = {
  '+': { prec: 1, apply: (a, b) => a + b },
  '-': { prec: 1, apply: (a, b) => a - b },
  '*': { prec: 2, apply: (a, b) => a * b },
  '/': { prec: 2, apply: (a, b) => (b === 0 ? null : a / b) },
}

export function tokenize(src) {
  const out = []
  let i = 0
  const s = String(src || '')

  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t') { i++; continue }

    if (c in OPS || c === '(' || c === ')') { out.push({ t: c }); i++; continue }

    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      const raw = s.slice(i, j)
      // Two dots is a typo, not a number. Saying so beats silently reading
      // "1.2.3" as 1.2 and carrying on with a wrong total.
      if ((raw.match(/\./g) || []).length > 1) return { error: 'badNumber', at: raw }
      out.push({ t: 'num', v: Number(raw) })
      i = j
      continue
    }

    // A name: letters (including Hebrew), digits after the first character,
    // and underscores.
    if (/[A-Za-z_\u0590-\u05FF]/.test(c)) {
      let j = i
      while (j < s.length && /[A-Za-z0-9_\u0590-\u05FF]/.test(s[j])) j++
      out.push({ t: 'name', v: s.slice(i, j) })
      i = j
      continue
    }

    return { error: 'badChar', at: c }
  }

  return { tokens: out }
}

/** Every name the formula mentions, so the UI can prompt for each one. */
export function namesIn(src) {
  const { tokens, error } = tokenize(src)
  if (error) return []
  return [...new Set(tokens.filter((x) => x.t === 'name').map((x) => x.v))]
}

export function evaluate(src, vars = {}) {
  const { tokens, error, at } = tokenize(src)
  if (error) return { error, at }
  if (!tokens.length) return { error: 'empty' }

  // Shunting-yard: operators to one stack, values to another, applied by
  // precedence. Iterative rather than recursive so a long formula cannot
  // blow the stack.
  const vals = []
  const ops = []

  const applyTop = () => {
    const op = ops.pop()
    const b = vals.pop()
    const a = vals.pop()
    if (a === undefined || b === undefined) return 'malformed'
    const r = OPS[op].apply(a, b)
    if (r === null) return 'divZero'
    vals.push(r)
    return null
  }

  let expectValue = true

  for (const tk of tokens) {
    if (tk.t === 'num' || tk.t === 'name') {
      if (!expectValue) return { error: 'malformed' }
      if (tk.t === 'num') vals.push(tk.v)
      else {
        const raw = vars[tk.v]
        if (raw === undefined || raw === '') return { error: 'unknownName', at: tk.v }
        const n = Number(raw)
        if (!Number.isFinite(n)) return { error: 'badValue', at: tk.v }
        vals.push(n)
      }
      expectValue = false
      continue
    }

    if (tk.t === '(') {
      if (!expectValue) return { error: 'malformed' }
      ops.push(tk.t)
      continue
    }

    if (tk.t === ')') {
      if (expectValue) return { error: 'malformed' }
      while (ops.length && ops[ops.length - 1] !== '(') {
        const e = applyTop()
        if (e) return { error: e }
      }
      if (!ops.length) return { error: 'unbalanced' }
      ops.pop()
      continue
    }

    // An operator. A leading minus is a negation, which the loop handles by
    // pushing a zero — "-5" becomes "0 - 5" without a separate unary path.
    if (expectValue) {
      if (tk.t !== '-') return { error: 'malformed' }
      vals.push(0)
    }
    while (ops.length && ops[ops.length - 1] !== '('
      && OPS[ops[ops.length - 1]].prec >= OPS[tk.t].prec) {
      const e = applyTop()
      if (e) return { error: e }
    }
    ops.push(tk.t)
    expectValue = true
  }

  if (expectValue) return { error: 'malformed' }

  while (ops.length) {
    if (ops[ops.length - 1] === '(') return { error: 'unbalanced' }
    const e = applyTop()
    if (e) return { error: e }
  }

  if (vals.length !== 1) return { error: 'malformed' }
  return { value: vals[0] }
}
