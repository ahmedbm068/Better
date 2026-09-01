/** Managing the two lists: habits to do, and things to avoid. */
import { useState } from 'react'
import type { Habit } from '@shared/types'
import { ALL_DAYS_MASK, maskFromWeekdays, weekdaysFromMask } from '@shared/streaks'
import { WEEKDAY_LETTERS, WEEKDAY_NAMES } from '@shared/format'
import { api } from '../lib/api'
import { useAction, useAsync } from '../lib/hooks'
import { Button, Empty, Modal, Note, Panel, Toggle } from '../components/ui'
import { SortableList } from '../components/SortableList'

export default function ListsPage(): React.JSX.Element {
  const [showArchived, setShowArchived] = useState(false)
  const { data: habits, reload: reloadHabits } = useAsync(
    () => api.listHabits(showArchived),
    [showArchived]
  )
  const { data: items, reload: reloadItems } = useAsync(
    () => api.listAvoidItems(showArchived),
    [showArchived]
  )
  const action = useAction()

  const [editingHabit, setEditingHabit] = useState<Habit | 'new' | null>(null)
  const [newAvoid, setNewAvoid] = useState('')

  const run = (fn: () => Promise<unknown>, after: () => void): void => {
    void action.run(fn).then(() => after())
  }

  return (
    <div className="p-6 max-w-[1240px] mx-auto space-y-5">
      <header className="flex items-end justify-between gap-5">
        <div>
          <div className="label">Lists</div>
          <h1 className="text-2xl mt-1 tracking-tight">What counts, and what does not</h1>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-dim cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="w-auto"
          />
          Show archived
        </label>
      </header>

      {action.error && (
        <Note tone={action.error.isGuard ? 'info' : 'warn'}>{action.error.message}</Note>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <Panel
          title="Habits — things I must do"
          right={
            <Button size="sm" onClick={() => setEditingHabit('new')}>
              Add
            </Button>
          }
        >
          {(habits ?? []).length === 0 ? (
            <Empty>No habits yet.</Empty>
          ) : (
            <SortableList
              items={habits ?? []}
              getId={(h) => h.id}
              itemNoun="habit"
              onReorder={(ids) => run(() => api.reorderHabits(ids), reloadHabits)}
              renderItem={(h) => (
                <div className="py-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className={`truncate ${h.archived ? 'text-faint line-through' : ''}`}>
                      {h.name}
                    </div>
                    <div className="num text-[11px] text-faint mt-0.5 tracking-widest">
                      {h.daysMask === ALL_DAYS_MASK
                        ? 'every day'
                        : weekdaysFromMask(h.daysMask)
                            .map((d) => WEEKDAY_NAMES[d])
                            .join(' ')}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditingHabit(h)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(() => api.updateHabit(h.id, { archived: !h.archived }), reloadHabits)
                    }
                  >
                    {h.archived ? 'Restore' : 'Archive'}
                  </Button>
                </div>
              )}
            />
          )}
        </Panel>

        <Panel title="Avoid — things I must not do">
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={newAvoid}
              placeholder="Add something to avoid"
              maxLength={80}
              onChange={(e) => setNewAvoid(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newAvoid.trim()) {
                  run(() => api.createAvoidItem(newAvoid), reloadItems)
                  setNewAvoid('')
                }
              }}
            />
            <Button
              disabled={!newAvoid.trim()}
              onClick={() => {
                run(() => api.createAvoidItem(newAvoid), reloadItems)
                setNewAvoid('')
              }}
            >
              Add
            </Button>
          </div>

          {(items ?? []).length === 0 ? (
            <Empty>Nothing on the list.</Empty>
          ) : (
            <SortableList
              items={items ?? []}
              getId={(item) => item.id}
              itemNoun="item"
              onReorder={(ids) => run(() => api.reorderAvoidItems(ids), reloadItems)}
              renderItem={(item) => (
                <div className="py-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className={`truncate ${item.archived ? 'text-faint line-through' : ''}`}>
                      {item.name}
                    </div>
                    {item.isQuitTracker && (
                      <div className="text-[11px] text-accent mt-0.5">pinned quit counter</div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Pin this item to the home screen counter"
                    onClick={() =>
                      run(
                        () => api.updateAvoidItem(item.id, { isQuitTracker: !item.isQuitTracker }),
                        reloadItems
                      )
                    }
                  >
                    {item.isQuitTracker ? 'Unpin' : 'Pin'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(
                        () => api.updateAvoidItem(item.id, { archived: !item.archived }),
                        reloadItems
                      )
                    }
                  >
                    {item.archived ? 'Restore' : 'Archive'}
                  </Button>
                </div>
              )}
            />
          )}
          <p className="text-[11px] text-faint mt-3">
            Drag the handle to reorder. Archiving keeps the history and stops the item counting
            against new days; deleting removes its record entirely.
          </p>
        </Panel>
      </div>

      <HabitModal
        target={editingHabit}
        onClose={() => setEditingHabit(null)}
        onSaved={() => {
          reloadHabits()
          setEditingHabit(null)
        }}
      />
    </div>
  )
}

function HabitModal({
  target,
  onClose,
  onSaved
}: {
  target: Habit | 'new' | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element | null {
  const action = useAction()
  const isNew = target === 'new'
  const habit = isNew ? null : target
  const [name, setName] = useState('')
  const [mask, setMask] = useState(ALL_DAYS_MASK)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const key = target === null ? null : isNew ? 'new' : String(habit?.id)
  if (key !== loadedFor) {
    setLoadedFor(key)
    setName(habit?.name ?? '')
    setMask(habit?.daysMask ?? ALL_DAYS_MASK)
  }

  if (!target) return null

  const days = weekdaysFromMask(mask)
  const toggleDay = (d: number): void => {
    setMask(maskFromWeekdays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]))
  }

  const save = (): void => {
    void action
      .run(() =>
        isNew ? api.createHabit(name, mask) : api.updateHabit(habit!.id, { name, daysMask: mask })
      )
      .then((ok) => ok && onSaved())
  }

  return (
    <Modal open title={isNew ? 'New habit' : 'Edit habit'} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <span className="label block mb-1">Name</span>
          <input
            type="text"
            value={name}
            maxLength={80}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()}
          />
        </div>

        <div>
          <span className="label block mb-1.5">Days it applies</span>
          <div className="flex gap-1">
            {WEEKDAY_LETTERS.map((letter, d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                aria-pressed={days.includes(d)}
                aria-label={WEEKDAY_NAMES[d]}
                title={WEEKDAY_NAMES[d]}
                className={`num w-8 h-8 rounded border text-[12px] cursor-pointer transition-colors
                  ${
                    days.includes(d)
                      ? 'bg-accent border-accent text-[#0B0D10] font-semibold'
                      : 'border-line text-faint hover:border-dim'
                  }`}
              >
                {letter}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-faint mt-1.5">
            Days it does not apply to are skipped entirely — they never break a streak.
          </p>
        </div>

        {!isNew && habit && (
          <Toggle
            checked={habit.archived}
            label="Archived"
            hint="Keeps history, stops counting on new days."
            onChange={(v) =>
              void action.run(() => api.updateHabit(habit.id, { archived: v })).then(onSaved)
            }
          />
        )}

        {action.error && <Note tone="warn">{action.error.message}</Note>}

        <div className="flex justify-between gap-2">
          {!isNew && habit ? (
            <Button
              variant="danger"
              onClick={() => void action.run(() => api.deleteHabit(habit.id)).then(onSaved)}
            >
              Delete
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={!name.trim() || mask === 0}>
              Save
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  )
}
