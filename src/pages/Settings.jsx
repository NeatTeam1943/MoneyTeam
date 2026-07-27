import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSeason } from '../context/SeasonContext'
import { useI18n } from '../lib/i18n'
import SimpleCrud from '../components/SimpleCrud'
import TemplatesManager from '../components/TemplatesManager'
import PendingUsers from '../components/PendingUsers'

export default function Settings() {
  const { t } = useI18n()
  const { isMentor } = useAuth()
  const { refresh: refreshSeasons } = useSeason()
  const [tab, setTab] = useState('seasons')

  const tabs = ['seasons', 'accounts', 'sources', 'categories', 'vendors', 'templates', 'priorityLevels', 'members']

  const configs = {
    seasons: {
      table: 'seasons', orderBy: 'start_date', canWrite: isMentor,
      // Seasons power the global top-bar selector (SeasonContext). That context
      // only loads once on app start, so without this it silently goes stale
      // after any add/edit/delete here — the dropdown won't show the new season
      // until a full page reload. Wiring onChanged keeps them in sync live.
      onChanged: refreshSeasons,
      fields: [
        { key: 'name', label: t('name'), type: 'text', required: true },
        { key: 'start_date', label: 'Start', type: 'date' },
        { key: 'end_date', label: 'End', type: 'date' },
        { key: 'is_active', label: t('active'), type: 'checkbox' },
      ],
    },
    accounts: {
      table: 'accounts', orderBy: 'name', canWrite: isMentor,
      fields: [
        { key: 'name', label: t('name'), type: 'text', required: true },
        { key: 'type', label: t('type'), type: 'select', default: 'bank', options: [
          { value: 'bank', label: 'Bank' }, { value: 'school', label: 'School' },
          { value: 'store_credit', label: 'Store credit' }, { value: 'city', label: 'City' }, { value: 'cash', label: 'Cash' },
        ] },
        { key: 'opening_balance', label: t('openingBalance'), type: 'number', default: 0 },
        { key: 'currency', label: 'Currency', type: 'text', default: 'ILS' },
        { key: 'is_active', label: t('active'), type: 'checkbox', default: true },
      ],
    },
    sources: {
      table: 'income_sources', orderBy: 'name', canWrite: isMentor,
      fields: [
        { key: 'name', label: t('name'), type: 'text', required: true },
        { key: 'type', label: t('type'), type: 'select', default: 'sponsor', options: [
          { value: 'sponsor', label: 'Sponsor' }, { value: 'city', label: 'City' }, { value: 'grant', label: 'Grant' },
          { value: 'fundraiser', label: 'Fundraiser' }, { value: 'dues', label: 'Dues' }, { value: 'other', label: 'Other' },
        ] },
        { key: 'contact', label: t('contact'), type: 'text' },
        { key: 'is_active', label: t('active'), type: 'checkbox', default: true },
      ],
    },
    categories: {
      table: 'categories', orderBy: 'name', canWrite: isMentor,
      fields: [
        { key: 'name', label: t('name'), type: 'text', required: true },
        { key: 'parent_id', label: t('parent'), dynamic: 'categories' },
        { key: 'team_scope', label: t('teamScope'), type: 'select', default: 'both', options: [
          { value: 'both', label: t('scope_both') }, { value: 'frc', label: t('scope_frc') }, { value: 'ftc', label: t('scope_ftc') },
        ] },
        { key: 'color', label: t('color'), type: 'color' },
      ],
    },
    vendors: {
      table: 'vendors', orderBy: 'name', canWrite: isMentor,
      fields: [
        { key: 'name', label: t('name'), type: 'text', required: true },
        { key: 'is_active', label: t('active'), type: 'checkbox', default: true },
      ],
    },
    priorityLevels: {
      table: 'priority_levels', orderBy: 'rank', canWrite: isMentor,
      fields: [
        { key: 'name', label: t('name'), type: 'text', required: true },
        { key: 'rank', label: t('rank'), type: 'number', default: 0 },
        { key: 'color', label: t('color'), type: 'color' },
      ],
    },
    members: {
      table: 'members', orderBy: 'email', canWrite: isMentor, manualId: true, invite: true, hint: t('newMemberHint'),
      fields: [
        { key: 'email', label: t('email'), type: 'text', required: true },
        { key: 'full_name', label: t('fullName'), type: 'text' },
        { key: 'role', label: t('role'), type: 'select', default: 'viewer', options: [
          { value: 'mentor', label: t('mentor') }, { value: 'student', label: t('student') }, { value: 'viewer', label: t('viewer') },
        ] },
      ],
    },
  }

  const cfg = configs[tab] || {}

  return (
    <div>
      <div className="tabs">
        {tabs.map((tb) => (
          <button key={tb} className={'tab' + (tab === tb ? ' active' : '')} onClick={() => setTab(tb)}>{t(tb)}</button>
        ))}
      </div>
      {!isMentor && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>{t('contactMentor')}</p>}
      {tab === 'members' && isMentor && <PendingUsers />}
      {tab === 'templates' ? <TemplatesManager canWrite={isMentor} /> : <SimpleCrud key={tab} {...cfg} />}
    </div>
  )
}
