import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const LookupsContext = createContext(null)

const isActive = (r) => r.is_active !== false
const nameMap = (rows) => Object.fromEntries((rows || []).map((r) => [r.id, r.name]))

// Indented label for a hierarchical category: a tab-width indent per level plus
// a dash. (An earlier "└" prefix read like a Hebrew/Latin letter in RTL.)
export const catLabel = (c) => '\u00A0\u00A0\u00A0\u00A0'.repeat(c.depth) + (c.depth ? '– ' : '') + c.name

// Parent first, then its children, each with depth + full path ("robot › sensors")
function buildTree(cats) {
  const byParent = {}
  for (const c of cats) {
    const k = c.parent_id || '__root__'
    ;(byParent[k] = byParent[k] || []).push(c)
  }
  const out = []
  const walk = (parentKey, depth, prefix) => {
    for (const c of (byParent[parentKey] || []).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix} › ${c.name}` : c.name
      out.push({ ...c, depth, path })
      walk(c.id, depth + 1, path)
    }
  }
  walk('__root__', 0, '')
  return out
}

// id -> Set of that category and every category beneath it (for budget roll-up)
function buildDescendants(cats) {
  const kids = {}
  for (const c of cats) if (c.parent_id) (kids[c.parent_id] = kids[c.parent_id] || []).push(c.id)
  const memo = {}
  for (const c of cats) {
    const acc = new Set([c.id])
    const stack = [c.id]
    while (stack.length) {
      const cur = stack.pop()
      for (const k of kids[cur] || []) if (!acc.has(k)) { acc.add(k); stack.push(k) }
    }
    memo[c.id] = acc
  }
  return memo
}

// Reference data changes rarely, so it is fetched ONCE here and shared by every
// page. Previously each page ran its own copy of this hook — 6 queries on every
// tab switch — and rebuilt all derived objects on every render, which broke the
// downstream useMemos (new identities each time) and made the UI feel laggy.
export function LookupsProvider({ children }) {
  const { session, isParent } = useAuth()
  const [data, setData] = useState({ accounts: [], categories: [], sources: [], levels: [], vendors: [], templates: [] })
  const [loading, setLoading] = useState(true)
  const loadedFor = useRef(null)

  const load = useCallback(async () => {
    const [a, c, s, p, v, tmpl] = await Promise.all([
      supabase.from('accounts').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('income_sources').select('*').order('name'),
      supabase.from('priority_levels').select('*').order('rank'),
      supabase.from('vendors').select('*').order('name'),
      supabase.from('shopping_templates').select('*').order('name'),
    ])
    // Keep previous values for any query that failed, so a transient error
    // never blanks the UI.
    setData((prev) => ({
      accounts:   a.error    ? prev.accounts   : (a.data || []),
      categories: c.error    ? prev.categories : (c.data || []),
      sources:    s.error    ? prev.sources    : (s.data || []),
      levels:     p.error    ? prev.levels     : (p.data || []),
      vendors:    v.error    ? prev.vendors    : (v.data || []),
      templates:  tmpl.error ? prev.templates  : (tmpl.data || []),
    }))
    setLoading(false)
  }, [])

  useEffect(() => {
    const uid = session?.user?.id || (isParent ? 'guest' : null)
    if (!uid) { setLoading(false); return }
    if (loadedFor.current === uid) return   // already loaded for this user
    loadedFor.current = uid
    setLoading(true)
    load()
  }, [session?.user?.id, isParent, load])

  const value = useMemo(() => {
    const { accounts, categories, sources, levels, vendors, templates } = data
    const descendants = buildDescendants(categories)
    return {
      accounts, categories, sources, levels, vendors, templates, loading, reload: load,
      accountsActive: accounts.filter(isActive),
      sourcesActive: sources.filter(isActive),
      vendorsActive: vendors.filter(isActive),
      templatesActive: templates.filter(isActive),
      categoryTree: buildTree(categories),
      descendantsOf: (id) => descendants[id] || new Set([id]),
      accountName: nameMap(accounts),
      categoryName: nameMap(categories),
      sourceName: nameMap(sources),
      levelName: nameMap(levels),
      catLabel,
    }
  }, [data, loading, load])

  return <LookupsContext.Provider value={value}>{children}</LookupsContext.Provider>
}

export const useLookupsContext = () => useContext(LookupsContext)
