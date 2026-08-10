import { useI18n } from '../lib/i18n'

/**
 * Primary and secondary sort, as one control.
 *
 * Every table that offered sorting offered ONE column: clicking a new header
 * replaced the old choice, so "category and then name" was not expressible —
 * only "category" or "name". Inside a category the rows then sat in whatever
 * order they arrived, which is the point a long list stops being scannable.
 *
 * Shared rather than repeated per page: three tables had three slightly
 * different sort implementations, and "sort by category" should mean the same
 * thing on all of them.
 */
export default function SortControls({ sort, setSort, columns }) {
  const { t } = useI18n()

  // The tie-breaker must not offer the column already chosen as primary —
  // "category, then category" sorts nothing and looks like a broken control.
  const secondary = columns.filter((c) => c.col !== sort.col)

  return (
    <>
      <select value={sort.col}
        onChange={(e) => setSort({ ...sort, col: e.target.value })}>
        {columns.map((c) => (
          <option key={c.col} value={c.col}>{t('sortBy')}: {c.label}</option>
        ))}
      </select>

      <button className="btn btn-sm" title={t('direction')}
        onClick={() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}>
        {sort.dir === 'asc' ? '↑' : '↓'}
      </button>

      <select value={sort.then || ''}
        onChange={(e) => setSort({ ...sort, then: e.target.value || null })}>
        <option value="">{t('thenBy')}: —</option>
        {secondary.map((c) => (
          <option key={c.col} value={c.col}>{t('thenBy')}: {c.label}</option>
        ))}
      </select>

      {sort.then && (
        <button className="btn btn-sm" title={t('direction')}
          onClick={() => setSort({ ...sort, thenDir: sort.thenDir === 'desc' ? 'asc' : 'desc' })}>
          {sort.thenDir === 'desc' ? '↓' : '↑'}
        </button>
      )}
    </>
  )
}
