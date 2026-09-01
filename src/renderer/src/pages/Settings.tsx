/** Settings, and the backup controls. Everything here stays on this machine. */
import { useEffect, useState } from 'react'
import type { CalcMethod, Settings } from '@shared/types'
import { CALC_METHOD_LABELS, CALC_METHODS } from '@shared/types'
import { formatClock } from '@shared/format'
import type { FileResult } from '@shared/api'
import { api } from '../lib/api'
import { useAction, useAsync } from '../lib/hooks'
import { Button, Field, Note, Panel, Toggle } from '../components/ui'
import { SyncPanel } from '../components/sync'

export default function SettingsPage(): React.JSX.Element {
  const { data: stored, reload } = useAsync(() => api.getSettings(), [])
  const { data: info } = useAsync(() => api.getInfo(), [])
  const action = useAction()

  const [draft, setDraft] = useState<Settings | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    if (stored) setDraft(stored)
  }, [stored])

  const { data: preview } = useAsync(
    () =>
      draft
        ? api.previewPrayerTimes({
            latitude: draft.latitude,
            longitude: draft.longitude,
            calcMethod: draft.calcMethod,
            madhab: draft.madhab,
            timezone: draft.timezone
          })
        : Promise.resolve(null),
    [draft?.latitude, draft?.longitude, draft?.calcMethod, draft?.madhab, draft?.timezone]
  )

  if (!draft) return <div className="p-6 text-faint">Loading…</div>

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    setDraft({ ...draft, [key]: value })

  /** Writes immediately — settings here are small and reversible. */
  const commit = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    const next = { ...draft, [key]: value }
    setDraft(next)
    void action.run(() => api.updateSettings({ [key]: value } as Partial<Settings>)).then(reload)
  }

  const runFile = (fn: () => Promise<FileResult>, label: string): void => {
    void action.run(async () => {
      const res = await fn()
      if (!res.ok) {
        setResult(null)
        return
      }
      const counts = res.counts
        ? ` (${Object.values(res.counts).reduce((a, b) => a + b, 0)} rows)`
        : ''
      setResult(
        `${label}: ${res.path}${counts}${res.backupPath ? ` · previous data copied to ${res.backupPath}` : ''}`
      )
      reload()
    })
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <header>
        <div className="label">Settings</div>
        <h1 className="text-2xl mt-1 tracking-tight">Configuration</h1>
      </header>

      {action.error && (
        <Note tone={action.error.isGuard ? 'info' : 'warn'}>{action.error.message}</Note>
      )}
      {result && <Note>{result}</Note>}

      <SyncPanel platform={info?.platform ?? ""} />

      <Panel title="Location and calculation">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Latitude">
            <input
              type="number"
              step="0.0001"
              value={draft.latitude}
              onChange={(e) => set('latitude', Number(e.target.value))}
              onBlur={() => commit('latitude', draft.latitude)}
            />
          </Field>
          <Field label="Longitude">
            <input
              type="number"
              step="0.0001"
              value={draft.longitude}
              onChange={(e) => set('longitude', Number(e.target.value))}
              onBlur={() => commit('longitude', draft.longitude)}
            />
          </Field>
          <Field label="Timezone" hint="IANA name, e.g. Africa/Tunis">
            <input
              type="text"
              value={draft.timezone}
              onChange={(e) => set('timezone', e.target.value)}
              onBlur={() => commit('timezone', draft.timezone)}
            />
          </Field>
          <Field label="Calculation method">
            <select
              value={draft.calcMethod}
              onChange={(e) => commit('calcMethod', e.target.value as CalcMethod)}
            >
              {CALC_METHODS.map((m) => (
                <option key={m} value={m}>
                  {CALC_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Asr madhab" hint="Hanafi puts Asr later in the afternoon.">
            <select
              value={draft.madhab}
              onChange={(e) => commit('madhab', e.target.value as 'shafi' | 'hanafi')}
            >
              <option value="shafi">Shafi / Maliki / Hanbali</option>
              <option value="hanafi">Hanafi</option>
            </select>
          </Field>
          <Field
            label="Day rollover offset (minutes)"
            hint="The day turns over at Fajr. Shift the boundary if you need to."
          >
            <input
              type="number"
              step="5"
              value={draft.dayStartOffsetMin}
              onChange={(e) => set('dayStartOffsetMin', Number(e.target.value))}
              onBlur={() => commit('dayStartOffsetMin', draft.dayStartOffsetMin)}
            />
          </Field>
        </div>

        {preview && (
          <div className="mt-4 pt-3 border-t border-line">
            <div className="label mb-2">Today with these settings</div>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {(['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const).map((k) => (
                <span key={k} className="num text-[12px]">
                  <span className="text-faint capitalize">{k} </span>
                  {formatClock(preview[k], draft.timezone)}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-faint mt-2">
              Changing these affects today and future days. Days already recorded keep the times
              they were judged against.
            </p>
          </div>
        )}
      </Panel>

      <Panel title="Notifications">
        <Toggle
          checked={draft.notifyOnWindowOpen}
          label="Notify when a prayer window opens"
          onChange={(v) => commit('notifyOnWindowOpen', v)}
        />
        <Field
          label="Reminders before a window closes (minutes)"
          hint="Comma separated. Only the tightest one that still applies fires."
        >
          <input
            type="text"
            value={draft.notifyLeadMinutes.join(', ')}
            onChange={(e) =>
              set(
                'notifyLeadMinutes',
                e.target.value
                  .split(',')
                  .map((s) => Number(s.trim()))
                  .filter((n) => Number.isFinite(n) && n > 0)
              )
            }
            onBlur={() => commit('notifyLeadMinutes', draft.notifyLeadMinutes)}
          />
        </Field>
      </Panel>

      <Panel title="Sleep targets">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Field label="Target bedtime">
            <input
              type="time"
              value={draft.targetBedtime}
              onChange={(e) => commit('targetBedtime', e.target.value)}
            />
          </Field>
          <Field label="Target wake time">
            <input
              type="time"
              value={draft.targetWakeTime}
              onChange={(e) => commit('targetWakeTime', e.target.value)}
            />
          </Field>
          <Field label="Tolerance (minutes)" hint="Both ends must land inside this.">
            <input
              type="number"
              step="5"
              value={draft.sleepTargetToleranceMin}
              onChange={(e) => set('sleepTargetToleranceMin', Number(e.target.value))}
              onBlur={() => commit('sleepTargetToleranceMin', draft.sleepTargetToleranceMin)}
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Quit counter">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Field label="Quit date">
            <input
              type="date"
              value={draft.quitDate ?? ''}
              onChange={(e) => commit('quitDate', e.target.value || null)}
            />
          </Field>
          <Field label="Cigarettes per day">
            <input
              type="number"
              value={draft.cigarettesPerDay}
              onChange={(e) => set('cigarettesPerDay', Number(e.target.value))}
              onBlur={() => commit('cigarettesPerDay', draft.cigarettesPerDay)}
            />
          </Field>
          <Field label="Cigarettes per pack">
            <input
              type="number"
              value={draft.cigarettesPerPack}
              onChange={(e) => set('cigarettesPerPack', Number(e.target.value))}
              onBlur={() => commit('cigarettesPerPack', draft.cigarettesPerPack)}
            />
          </Field>
          <Field label="Price per pack">
            <input
              type="number"
              step="0.1"
              value={draft.pricePerPack}
              onChange={(e) => set('pricePerPack', Number(e.target.value))}
              onBlur={() => commit('pricePerPack', draft.pricePerPack)}
            />
          </Field>
          <Field label="Currency">
            <input
              type="text"
              maxLength={8}
              value={draft.currency}
              onChange={(e) => set('currency', e.target.value)}
              onBlur={() => commit('currency', draft.currency)}
            />
          </Field>
        </div>
      </Panel>

      <Panel title="Application">
        <Toggle
          checked={draft.theme === 'dark'}
          label="Dark theme"
          onChange={(v) => commit('theme', v ? 'dark' : 'light')}
        />
        <Toggle
          checked={draft.minimizeToTray}
          label="Closing the window minimises to the tray"
          hint="Keeps prayer notifications running. Quit from the tray menu."
          onChange={(v) => commit('minimizeToTray', v)}
        />
        <Toggle
          checked={draft.launchOnStartup}
          label="Launch on Windows startup"
          hint="Starts hidden in the tray."
          onChange={(v) => {
            setDraft({ ...draft, launchOnStartup: v })
            void action.run(() => api.setLaunchOnStartup(v)).then(reload)
          }}
        />
        <Field label="Prompt about a running session after (hours)">
          <input
            type="number"
            min={1}
            max={24}
            value={draft.longSessionWarnHours}
            onChange={(e) => set('longSessionWarnHours', Number(e.target.value))}
            onBlur={() => commit('longSessionWarnHours', draft.longSessionWarnHours)}
          />
        </Field>
      </Panel>

      <Panel title="Backup">
        <p className="quiet mb-4">
          Everything lives in one local database file. These exports are the only backup, so take
          one regularly.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => runFile(() => api.exportJson(), 'Exported')}>
            Export JSON
          </Button>
          <Button onClick={() => runFile(() => api.exportCsv(), 'Exported')}>Export CSV</Button>
          <Button variant="danger" onClick={() => runFile(() => api.importJson(), 'Imported')}>
            Restore from JSON
          </Button>
        </div>
        <p className="text-[11px] text-faint mt-3">
          Restoring replaces everything currently stored. The existing database is copied aside
          first.
        </p>
      </Panel>

      <Panel title="About">
        <dl className="text-[12px] space-y-1">
          <Row label="Version" value={info?.version ?? '—'} />
          <Row label="Electron" value={info?.electron ?? '—'} />
          <Row label="Timezone in use" value={info?.timezone ?? '—'} />
          <Row label="Database" value={info?.dbPath ?? '—'} />
        </dl>
        <p className="text-[11px] text-faint mt-3">
          No account, no server, no telemetry. Nothing leaves this machine.
        </p>
      </Panel>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <dt className="text-faint w-[130px] shrink-0">{label}</dt>
      <dd className="num break-all">{value}</dd>
    </div>
  )
}
