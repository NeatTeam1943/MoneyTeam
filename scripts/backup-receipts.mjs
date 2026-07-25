// Downloads every file in the "receipts" bucket into ./backup/receipts/,
// preserving the folder structure (one folder per season id).
// Used by .github/workflows/backup.yml. Requires the SERVICE key, because the
// backup must see all files regardless of RLS.

import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const url = process.env.SUPABASE_URL
const key = process.env.SERVICE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const OUT = 'backup/receipts'
const BUCKET = 'receipts'

// The storage API lists one folder at a time, so walk the tree.
async function walk(prefix = '') {
  const files = []
  let offset = 0
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET)
      .list(prefix, { limit: 100, offset })
    if (error) throw error
    if (!data.length) break
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      // Folders come back with a null id
      if (entry.id === null) files.push(...await walk(path))
      else files.push(path)
    }
    if (data.length < 100) break
    offset += 100
  }
  return files
}

const paths = await walk()
console.log(`found ${paths.length} receipt file(s)`)

let ok = 0, failed = 0
for (const path of paths) {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(path)
    if (error) throw error
    const dest = join(OUT, path)
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, Buffer.from(await data.arrayBuffer()))
    ok++
  } catch (e) {
    failed++
    console.error(`failed: ${path} — ${e.message}`)
  }
}

console.log(`downloaded ${ok}, failed ${failed}`)
if (failed && ok === 0) process.exit(1)   // total failure should fail the job
