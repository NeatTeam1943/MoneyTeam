import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'
import { lineAmount } from '../domain/money'

/**
 * A payment summary for one income — the thing you hand back to a parent.
 *
 * Printed through the browser rather than built with jsPDF or html2canvas.
 * That is not laziness, it is the only approach here that gets HEBREW right:
 * a PDF library has to be handed a font that contains Hebrew glyphs, and then
 * has to reorder the run itself, because the characters are stored in logical
 * order and must be drawn right to left. Getting that wrong produces a PDF
 * that looks fine in the preview and comes out reversed — "םולש" — in print.
 * The browser already has a text engine that does this correctly, and
 * window.print() hands the result to it. Selectable text, real page breaks,
 * no dependency, and it works on the phone the mentor actually has.
 *
 * Hidden on screen. The screen is a working view with buttons; this is a
 * document.
 */
export default function IncomeReceiptPrint({ tx, lines, seasonName, payerName }) {
  const { t } = useI18n()
  const printedOn = new Date().toLocaleDateString('he-IL')
  const txDate = tx?.date ? new Date(tx.date).toLocaleDateString('he-IL') : ''
  /**
   * An income saved before breakdowns existed has no lines, and printing it
   * produced a summary with no rows and a total of zero — a sheet that says
   * the parent paid nothing. The header IS the single line in that case.
   */
  const rows = (lines && lines.length) ? lines : (tx ? [{
    description: tx.description || t('income'),
    unit_price: tx.amount,
    quantity: 1,
    amount: tx.amount,
    payment_method: null,
  }] : [])
  const total = rows.reduce((s, l) => s + lineAmount(l), 0)

  return (
    <div className="receipt-print">
      <header className="receipt-head">
        <div className="receipt-team">NEAT TEAM 1943</div>
        {/* The title names who paid, so the sheet identifies itself once it
            has been printed and separated from the screen it came from — and
            so the saved PDF is named after it rather than after the app. */}
        <h1>{t('paymentSummary')} · {payerName || t('unknownPayer')}</h1>
        <div className="receipt-meta">
          {seasonName ? `${seasonName} · ` : ''}{t('printedOn')} {printedOn}
        </div>
      </header>

      <table className="receipt-table">
        <thead>
          <tr>
            <th>{t('date')}</th>
            <th>{t('description')}</th>
            {/* Per ITEM, not per row total — the two are different numbers the
                moment a quantity is not 1, and a parent checking the sheet is
                checking exactly that multiplication. */}
            <th className="num">{t('unitPrice')}</th>
            <th className="num">{t('quantity')}</th>
            <th>{t('paymentMethod')}</th>
            <th className="num">{t('total')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => {
            const amount = lineAmount(l)
            return (
              <tr key={l.id || i} className={amount < 0 ? 'receipt-discount' : undefined}>
                <td>{txDate}</td>
                <td>{l.description || '—'}</td>
                <td className="num mono">{l.unit_price != null ? money(l.unit_price) : money(amount)}</td>
                <td className="num mono">{l.quantity ?? 1}</td>
                <td>{l.payment_method || '—'}</td>
                <td className="num mono">{money(amount)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="5">{t('total')}</td>
            <td className="num mono">{money(total)}</td>
          </tr>
        </tfoot>
      </table>

      {tx?.notes && <div className="receipt-notes">{tx.notes}</div>}
    </div>
  )
}
