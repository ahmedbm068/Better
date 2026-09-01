/**
 * The bridge.
 *
 * The renderer runs with `contextIsolation` on and no Node integration; this
 * file is the entire surface it can reach. Each method is a thin `invoke` to a
 * channel of the same name, so there is nothing here to keep in sync but names.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent, ImHimApi } from '@shared/api'

const call =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args) as Promise<T>

/** Events the renderer is allowed to listen for. */
const ALLOWED_EVENTS: readonly AppEvent[] = [
  'tick',
  'day:rollover',
  'work:long-session',
  'review:due',
  'navigate',
  'data:changed',
  'sync:changed'
]

const api = {
  getInfo: call('getInfo'),
  getSettings: call('getSettings'),
  updateSettings: call('updateSettings'),
  previewPrayerTimes: call('previewPrayerTimes'),

  currentDate: call('currentDate'),
  getDay: call('getDay'),
  setDayNote: call('setDayNote'),

  checkPrayer: call('checkPrayer'),
  uncheckPrayer: call('uncheckPrayer'),

  listHabits: call('listHabits'),
  createHabit: call('createHabit'),
  updateHabit: call('updateHabit'),
  deleteHabit: call('deleteHabit'),
  reorderHabits: call('reorderHabits'),
  setHabitDone: call('setHabitDone'),
  useGraceDay: call('useGraceDay'),
  clearGraceDay: call('clearGraceDay'),

  listAvoidItems: call('listAvoidItems'),
  createAvoidItem: call('createAvoidItem'),
  updateAvoidItem: call('updateAvoidItem'),
  deleteAvoidItem: call('deleteAvoidItem'),
  reorderAvoidItems: call('reorderAvoidItems'),
  setAvoidStatus: call('setAvoidStatus'),
  getQuitStats: call('getQuitStats'),

  startWork: call('startWork'),
  stopWork: call('stopWork'),
  getWorkTotals: call('getWorkTotals'),
  listProjects: call('listProjects'),
  listWorkForDate: call('listWorkForDate'),
  updateWorkSession: call('updateWorkSession'),
  deleteWorkSession: call('deleteWorkSession'),
  getProjectTotals: call('getProjectTotals'),
  getWorkBuckets: call('getWorkBuckets'),
  resolveLongSession: call('resolveLongSession'),

  goingToSleep: call('goingToSleep'),
  wokeUp: call('wokeUp'),
  getSleep: call('getSleep'),
  editSleep: call('editSleep'),
  clearSleep: call('clearSleep'),
  getRecentNights: call('getRecentNights'),

  getMonth: call('getMonth'),
  getWeek: call('getWeek'),
  getStats: call('getStats'),

  getWeekStats: call('getWeekStats'),
  getReview: call('getReview'),
  saveReview: call('saveReview'),
  listReviews: call('listReviews'),
  isReviewDue: call('isReviewDue'),
  getReviewAnchor: call('getReviewAnchor'),

  exportJson: call('exportJson'),
  exportCsv: call('exportCsv'),
  importJson: call('importJson'),

  hideWindow: call('hideWindow'),
  setLaunchOnStartup: call('setLaunchOnStartup'),

  signIn: call('signIn'),
  signOut: call('signOut'),
  syncNow: call('syncNow'),
  syncStatus: call('syncStatus'),

  on(event: AppEvent, handler: (payload: unknown) => void): () => void {
    if (!ALLOWED_EVENTS.includes(event)) return () => {}
    const listener = (_e: unknown, payload: unknown): void => handler(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  }
} satisfies Record<keyof ImHimApi, unknown>

contextBridge.exposeInMainWorld('api', api)
