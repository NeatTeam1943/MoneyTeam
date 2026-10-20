import { useI18n } from '../lib/i18n'
import { lineAmount } from '../domain/money'

// Imported rather than written as "./receipt-x.png" against the public folder.
// A bare string is resolved at RUN time against whatever the document's URL
// happens to be, which silently 404s if the app is reached without the
// trailing slash; imported, the path is resolved at BUILD time and the build
// fails loudly if a file ever goes missing instead of printing a blank page.
import logoIriya from '../assets/receipt-iriya.png'
import logoNeatTeam from '../assets/receipt-neatteam.png'
import logoMechanic from '../assets/receipt-mechanic.png'
import logoBegin from '../assets/receipt-begin.png'

/**
 * Plain digits, grouped, with the decimals dropped when they are both zero.
 * Deliberately NOT the app's money() helper: that puts a ₪ on every figure,
 * and on the printed sheet the currency belongs once in the column heading —
 * which is where the team's own stationery puts it. A column of "₪1,500.00"
 * also drags the currency sign through the bidi algorithm on every row for
 * no gain.
 */
const num = (n) => {
  const v = Number(n) || 0
  return v.toLocaleString('he-IL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

/**
 * The payment invoice handed to a parent.
 *
 * Laid out to match the sheet the team already issues by hand — the same four
 * logos across the top, the date in the corner, the centred title, "לכבוד"
 * with the addressee under it, the table, and a signature rule. The point of
 * copying it is that a parent who has had one of these before should not have
 * to work out that this is the same document.
 *
 * Printed through the browser rather than built with a PDF library, which is
 * the only approach here that gets HEBREW right: a PDF library has to be
 * handed a font containing Hebrew glyphs and then has to reorder the run
 * itself, because the characters are stored in logical order and drawn right
 * to left. Getting that wrong produces a file that looks correct in a preview
 * and comes out reversed in print. The browser already has a text engine that
 * does this properly.
 *
 * Hidden on screen. The screen is a working view with buttons; this is a
 * document.
 */
export default function IncomeReceiptPrint({ tx, lines, addressee, payerName }) {
  const { t } = useI18n()
  // The transaction's own date, not today's. The sheet records when the money
  // was received; when it happened to be printed is nobody's business.
  // dd/mm/yyyy with slashes, which is how the date is written on the sheet
  // this copies. Built by hand rather than with toLocaleDateString, which
  // returns dots for he-IL and would quietly disagree with the stationery.
  const d = tx?.date ? new Date(tx.date) : new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const txDate = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`

  /**
   * An income saved before breakdowns existed has no lines, and printing one
   * produced an invoice with no rows and a total of zero — a sheet stating
   * that the parent paid nothing. The header IS the single line in that case.
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
      <div className="receipt-frame">
        {/* Left to right regardless of the page's direction: this is the
            order the logos run in on the printed stationery, and flipping
            them with the text would put the school's crest on the wrong
            side of the city's. */}
        <div className="receipt-logos">
          <img src={logoIriya} alt="" />
          <img src={logoNeatTeam} alt="" />
          <img src={logoMechanic} alt="" />
          <img src={logoBegin} alt="" />
        </div>

        <div className="receipt-date">{txDate}</div>

        {/* The name here is the one on "paid by", which the team fills in with
            the STUDENT's name — so the invoice says whose place it covers.
            Who it is addressed to is a different person and is asked for
            separately. */}
        <h1 className="receipt-title">
          {t('paymentInvoice')}{payerName ? ` ${payerName}` : ''}
        </h1>

        <div className="receipt-to">
          <div>{t('addressedTo')}</div>
          {/* Underlined when there is a name, as on the sheet this copies; a
              rule to write on when the dialog was dismissed without one, so
              an invoice is never short of a place to put it. */}
          {addressee
            ? <div className="receipt-to-name">{addressee}</div>
            : <div className="receipt-to-blank" />}
        </div>

        <table className="receipt-table">
          <thead>
            <tr>
              <th>{t('description')}</th>
              {/* Per ITEM, with the count beside it. The two are different
                  numbers the moment a quantity is not 1, and a parent checking
                  the sheet is checking exactly that multiplication. */}
              <th className="num">{t('unitPrice')} ₪</th>
              <th className="num">{t('quantity')}</th>
              <th>{t('paymentMethod')}</th>
              <th className="num">{t('total')} ₪</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => {
              const amount = lineAmount(l)
              return (
                <tr key={l.id || i}>
                  <td>{l.description || '—'}</td>
                  <td className="num">{num(l.unit_price != null ? l.unit_price : amount)}</td>
                  <td className="num">{l.quantity ?? 1}</td>
                  <td>{l.payment_method || '—'}</td>
                  <td className="num">{num(amount)}</td>
                </tr>
              )
            })}
            <tr className="receipt-total-row">
              <td>{t('total')}</td>
              <td /><td /><td />
              <td className="num">{num(total)}</td>
            </tr>
          </tbody>
        </table>

        {/* Signed by hand after printing, so this is a rule to write on and
            not a field anybody fills in on screen. */}
        <div className="receipt-sign">
          <span>{t('signature')}</span>
          <span className="receipt-sign-rule" />
        </div>

        {tx?.notes && <div className="receipt-notes">{tx.notes}</div>}
      </div>
    </div>
  )
}
