import { useI18n } from '../lib/i18n'

const REPO = 'https://github.com/NeatTeam1943/MoneyTeam/issues/new'

/**
 * A link to open a GitHub issue, with the context already filled in.
 *
 * A bare "report a bug" link produces reports that need a follow-up question
 * before anyone can act: which page, which season, which browser. All of that
 * is known here, so it is put in the body and the reporter only has to
 * describe what happened.
 *
 * Deliberately a link and not a form: the app has no way to post to GitHub
 * without a token, and asking people to sign in to something new is how a
 * report stops being written at all.
 */
export default function ReportIssue() {
  const { t } = useI18n()

  const href = () => {
    const body = [
      '',
      '',
      '---',
      `page: ${window.location.hash || '/'}`,
      `screen: ${window.innerWidth}×${window.innerHeight}`,
      `browser: ${navigator.userAgent}`,
      `time: ${new Date().toISOString()}`,
    ].join('\n')
    return `${REPO}?body=${encodeURIComponent(body)}`
  }

  return (
    <a className="report-issue" href={href()} target="_blank" rel="noreferrer"
      title={t('reportIssue')}>
      <span aria-hidden="true">⚑</span> {t('reportIssue')}
    </a>
  )
}
