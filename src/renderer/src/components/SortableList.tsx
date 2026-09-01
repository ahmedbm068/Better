/**
 * A drag-to-reorder list.
 *
 * Dragging is armed by the grip handle only, so the row's own buttons stay
 * clickable — but the drag itself is on the whole row, which is what makes the
 * ghost look like the thing you picked up.
 *
 * The handle is also a real button: focus it and Arrow Up / Arrow Down move the
 * item, so reordering never depends on being able to drag.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface SortableListProps<T> {
  items: T[]
  getId: (item: T) => number
  /** Receives the ids in their new order. */
  onReorder: (ids: number[]) => void
  renderItem: (item: T, index: number) => ReactNode
  /** Label used in the handle's tooltip, e.g. "habit". */
  itemNoun?: string
}

function move<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

export function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  itemNoun = 'item'
}: SortableListProps<T>): React.JSX.Element {
  // Shows the new order immediately, rather than waiting for the round trip.
  const [pending, setPending] = useState<T[] | null>(null)
  // `dragIndex` drives what the rows look like; `dragFrom` is what the drop
  // actually reads. Keeping the authoritative value in a ref means a drop is
  // handled correctly even if no render happened between dragstart and drop.
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)
  const handleRefs = useRef(new Map<number, HTMLButtonElement>())

  /*
   * Rows are always `draggable`; a drag that did not start on a grip is
   * cancelled in `onDragStart`.
   *
   * The obvious alternative — flipping `draggable` on in the handle's mousedown
   * — depends on React having re-rendered before the browser decides whether a
   * drag gesture has begun. A ref sidesteps that race entirely.
   */
  const armed = useRef(false)

  useEffect(() => {
    const disarm = (): void => {
      armed.current = false
    }
    window.addEventListener('mouseup', disarm)
    window.addEventListener('dragend', disarm)
    return () => {
      window.removeEventListener('mouseup', disarm)
      window.removeEventListener('dragend', disarm)
    }
  }, [])

  // Once the reordered list arrives from the main process, stop overriding it.
  useEffect(() => setPending(null), [items])

  const list = pending ?? items

  const commit = (next: T[], focusId?: number): void => {
    setPending(next)
    onReorder(next.map(getId))
    if (focusId !== undefined) {
      // Keep the keyboard on the row that just moved.
      requestAnimationFrame(() => handleRefs.current.get(focusId)?.focus())
    }
  }

  const reset = (): void => {
    setDragIndex(null)
    setOverIndex(null)
    dragFrom.current = null
    armed.current = false
  }

  const onDrop = (target: number): void => {
    const from = dragFrom.current
    if (from === null || from === target) return reset()
    commit(move(list, from, target))
    reset()
  }

  const nudge = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= list.length) return
    commit(move(list, index, target), getId(list[index]))
  }

  return (
    <ul onDragLeave={() => setOverIndex(null)}>
      {list.map((item, index) => {
        const id = getId(item)
        const isDragging = dragIndex === index
        // The gap opens above the hovered row, or below it when moving down.
        const showLineAbove = overIndex === index && dragIndex !== null && dragIndex > index
        const showLineBelow = overIndex === index && dragIndex !== null && dragIndex < index

        return (
          <li
            key={id}
            draggable
            onDragStart={(e) => {
              if (!armed.current) {
                // Started somewhere other than the grip — let the row be a row.
                e.preventDefault()
                return
              }
              dragFrom.current = index
              setDragIndex(index)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', String(id))
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (overIndex !== index) setOverIndex(index)
            }}
            onDrop={(e) => {
              e.preventDefault()
              onDrop(index)
            }}
            onDragEnd={reset}
            className={`relative flex items-center gap-2 border-t border-line first:border-t-0
              transition-opacity ${isDragging ? 'opacity-40' : ''}`}
          >
            {showLineAbove && <DropLine position="top" />}
            {showLineBelow && <DropLine position="bottom" />}

            <button
              type="button"
              ref={(el) => {
                if (el) handleRefs.current.set(id, el)
                else handleRefs.current.delete(id)
              }}
              aria-label={`Reorder ${itemNoun}. Use arrow keys to move it.`}
              title="Drag to reorder, or use the arrow keys"
              onMouseDown={() => {
                armed.current = true
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  nudge(index, -1)
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  nudge(index, 1)
                }
              }}
              className="shrink-0 self-stretch px-1.5 flex items-center text-faint
                hover:text-fg cursor-grab active:cursor-grabbing"
            >
              <Grip />
            </button>

            <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
          </li>
        )
      })}
    </ul>
  )
}

function DropLine({ position }: { position: 'top' | 'bottom' }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`absolute left-0 right-0 h-[2px] bg-accent pointer-events-none
        ${position === 'top' ? '-top-px' : '-bottom-px'}`}
    />
  )
}

/** Six dots — the conventional "pick me up" mark, drawn rather than imported. */
function Grip(): React.JSX.Element {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
      {[4, 8, 12].map((y) =>
        [2, 8].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill="currentColor" />)
      )}
    </svg>
  )
}
