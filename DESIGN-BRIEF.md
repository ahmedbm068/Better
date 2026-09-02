# Design brief — paste everything below into Claude Design

---

Design the complete UI for a Windows desktop app called **"Better"**. Produce
**one artboard per screen**, ten screens total, laid out on a single canvas.
Every artboard is **1400 × 880** (the app's window size). Desktop only — no
mobile, no responsive breakpoints below 1100px.

## What the app is

A private discipline tracker for one person. It runs fully offline, stores
everything in a local file, and has no account, no sync, and no social features.
Nobody else will ever see this screen. It is opened several times a day, for
about fifteen seconds at a time, to answer: *what do I still have to do today?*

## The feeling it must have

Calm, quiet and legible. It is opened for fifteen seconds at a time by someone
who wants one question answered, so it should feel like a good clock: composed,
unhurried, and pleasant to look at.

An earlier version of this brief asked for an aircraft panel or a trading
terminal. That was a mistake, and the build that came out of it read as a
laboratory instrument — every label shouted in capitals, nothing had a corner,
and nine panels competed on one plane. **That direction is retired.** What
replaced it:

- **Softness carries the calm.** Rounded cards, one real elevation step, and
  space between unrelated things. Depth is a panel ground plus a hairline
  highlight, not a cage of 1px rules.
- **Sentence case.** Capitals and monospace are for numbers and the occasional
  section kicker. A label that shouts as loudly as the data it introduces is
  noise.
- **Scale does the ranking.** One focal point per screen at a size nothing else
  comes near, and everything settled folded away behind a count.
- **Motion is functional.** Things that arrive, rise; a check draws itself; the
  live thing breathes. Nothing moves for decoration, and everything respects
  `prefers-reduced-motion`.

Hard rules, unchanged:

- **No emoji. No mascots.** Ever.
- **One quote a day, and no more than that.** The app carries a short line on
  Today, shown full screen once on opening and then parked in its own card. It
  is the one soft thing here, so it stays disciplined: two lines at most, never
  attributed, never scripture, and never anything a Muslim reader would have to
  disagree with — no fate, no luck, no universe that provides, nothing that
  names divinity, and no claim over outcomes. The rules and the tests that hold
  them are in `src/shared/quotes.ts` and `tests/quotes.test.ts`.
- **No guilt language.** A missed prayer says "missed" and nothing more. Never
  "You failed", never a red shame banner, never a sad state. Facts only, stated
  flatly. The data does the persuading.
- **One accent colour**, plus muted semantic colours for done / late / missed /
  grace. The ground is a deep indigo night and the accent is the warm gold of
  first light; a cool ground under a warm accent is what makes the live thing
  read as lit rather than merely coloured. A second accent exists only for the
  night end of the day arc.
- **Monospace, tabular figures for every number**, timer, countdown and clock.
  Prose stays in a sans stack.
- **System font stacks only.** The app is offline and fetches nothing — no
  Google Fonts, no icon fonts, no CDN. Icons are hand-written inline SVG on one
  geometry: a 24 grid, 1.6 stroke, round caps, `currentColor`.
- **Dark theme is the default**; a light theme must work from the same tokens,
  and a third mode, **Follow the sun**, grades between them using the real
  sunrise and sunset at the user's coordinates — the same solar events the
  prayer times are built from, so the theme and the day arc read one sky.
  It grades *within* a polarity and inverts once at the sun's crossing: light
  text on dark and dark text on light meet as the same grey halfway between, so
  a straight interpolation goes blind in the middle (measured at 1.07:1).

## The problem that was solved

The build before this one was correct but unfriendly. Its faults, and what
answered them:

1. **Nine panels on the home screen at once**, with no hierarchy — the prayer
   countdown competed with seven other cards. *Now four tiers: header, the day
   arc, one list beside the score, and three tiles.*
2. **Everything on one plane.** *Now one focal point, and everything already
   dealt with collapses behind a "Settled" count.*
3. **Rows were overloaded** — checkbox, name, seven-dot strip, streak, record
   and a button on a single habit row. *The strip moved into the expanded row;
   the slip action appears on hover.*
4. **Type was too small and too uniform**, 13px body against 10px labels. *The
   countdown is 54px, the date 26px, body 14px, and nothing renders below 11px.*
5. **Not enough whitespace**, everything 12–16px apart whether related or not.

These were fixed with **hierarchy and progressive disclosure**, not by deleting
features. Every capability listed below is still reachable. Secondary detail may
live behind a hover, an expandable row, or its own page — but it cannot
disappear.

Hold the line at: **one obvious focal point per screen**, at most three or four
regions competing for attention, and a clear reading order.

## The screens

### 1. Today (home — the most important screen by far)

Opened on launch. In one glance it must answer four questions:

- **What prayer is next and how long do I have?** This is the hero: the **day
  arc**, a 140-degree bow spanning Fajr to the close of Isha, carrying the five
  windows as coloured bands with the present moment travelling along it, and the
  countdown set inside its bowl. It is unmistakably the largest thing on screen.
  When a window is nearly closed it reads as urgent without turning into an
  alarm. The arc is also the mark, drawn again at 24px.
- **What is still unchecked today?**
- **How many days smoke-free?**
- **How long have I worked today?**

Must contain, somewhere: the five prayers with their times and states; the daily
habit checklist with a 7-day history strip and streak per habit; the avoid list
with a "clean" confirmation and a way to log a slip with a one-line note; the
pinned smoke-free counter with money saved; today's and this week's focused
time with a start-work button; sleep times with "To sleep" and "Woke up"
buttons; and today's score out of 100.

That is a lot, so it is grouped and ranked. Prayers, habits and avoid merge into
one **"What's left"** column: only what is still open, with everything settled
folded behind a count. A prayer whose window has not opened is not listed at
all — the arc already shows all five. The score sits beside the list as a ring
and five bars, and focus, sleep and the quit counter are three equal tiles
below.

### 2. Calendar

Month grid. Each day cell: five small dots for the prayers (green done, muted
red missed, grey upcoming), a thin bar for the day's score, a marker if a slip
was logged, and a marker for a grace day. Days before the app was installed
render blank — they are not failures. Clicking a day opens screen 4.

### 3. Week

The same information as a month cell but laid out horizontally across seven
columns, with more detail per day: score, prayers done, habits done, focused
time, sleep duration, and the day's note. Plus four summary tiles above.

### 4. Day detail

Everything logged on one day: prayers with times and states, habits done and
missed, slips with their notes, work sessions with durations, sleep times, the
score broken into its five components, and a free-text note. Past days are
read-only except the note. Needs an obvious way back.

### 5. Work

A start/stop timer. A start-work button; naming a session with autocomplete
from previous project names; a running stopwatch; stop with an optional one-line
note. Today's session log with edit and delete. A bar chart of totals per week
or per month, and hours ranked per project.

### 6. Sleep

"Going to sleep" and "Woke up" buttons, plus manual editing of both times for
the nights a button went unpressed. A 30-night chart: duration bars with a
bedtime scatter over the top, so schedule drift is visible. A list of recent
nights. Target bedtime and wake time shown with tolerance.

### 7. Stats

Prayer completion rate over time, a score trend line, a GitHub-style
contribution heatmap of habit completion, clean days per avoid item, and a row
of headline numbers. A range switcher (30 / 90 / 180 / 365 days).

### 8. Weekly review

Shown Sunday evening. Average score, prayer completion rate, total focused
hours, average sleep, best and worst day, longest streaks, a per-day score
chart. Two text boxes: how the week went, and *one* thing to fix next week.
Past reviews are browsable.

### 9. Lists

Managing two lists: habits (create, rename, reorder, archive, delete, and pick
which weekdays each applies to), and avoid items (same, plus pinning one as the
smoke-free counter).

### 10. Settings

Coordinates, timezone, prayer calculation method, madhab, day-rollover offset,
with a live preview of today's computed times. Notification toggles and lead
times. Sleep targets. Quit date, cigarettes per day, price per pack, currency.
Theme, minimise-to-tray, launch on startup. Export to JSON or CSV, and restore
from JSON. An about section.

## Two states that need care

- **Empty / first run.** On day one there is no history: no streaks, an empty
  heatmap, a flat chart. It must look deliberate, not broken.
- **Streaks.** Every habit and avoid item shows a current streak *and* an
  all-time record, because a broken streak should never erase the evidence that
  it was done before. There is also a **grace day**: one per month per habit
  that keeps a streak alive, which must be visibly marked as a grace day — never
  disguised as a real completion. Design how a grace day is offered and how a
  used one is shown.

## What to hand back

1. Ten artboards, one per screen, at 1400 × 880.
2. A **design tokens** block: the full colour palette as CSS custom properties
   for both dark and light, the type scale with sizes and weights, the spacing
   scale, border radii, and border colours.
3. Notes on the **reusable components** — panel, button variants, checkbox row,
   stat tile, streak badge, modal, chart frame — so they can be built once.
4. For the Today screen, a short note on the **hierarchy**: what is largest,
   what is secondary, and what is demoted.

## Technical constraints on the output

It will be rebuilt in React + TypeScript + Tailwind CSS v4, inside Electron.

- Themes come from CSS custom properties on `:root` and `[data-theme='light']`,
  so give me both palettes as variables, not hardcoded hex per component.
- Charts are hand-written inline SVG — no charting library. Keep them simple:
  bars, lines, scatter dots, a heatmap grid.
- No external images, fonts, or network requests of any kind.
- Depth is the `bg` / `panel` / `panel2` ground steps plus one soft shadow and a
  hairline top highlight. Gradients are reserved for the day arc, where they
  mean something: night warming into light.
- Motion lives in the token sheet as named keyframes (`rise`, `pop`, `draw`,
  `breathe`) with a `prefers-reduced-motion` escape, so no component invents its
  own.
