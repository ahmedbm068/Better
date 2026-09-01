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

It is an **instrument**, not a consumer habit app. Think aircraft panel, trading
terminal, or a good CLI — calm, dense where density earns its place, and honest.

Hard rules:

- **No emoji. No mascots. No illustrations. No motivational quotes.** Ever.
- **No guilt language.** A missed prayer says "missed" and nothing more. Never
  "You failed", never a red shame banner, never a sad state. Facts only, stated
  flatly. The data does the persuading.
- **One accent colour.** Currently amber `#E8A33D`. You may propose a different
  single accent, but only one, plus muted semantic colours for done/missed.
- **Monospace, tabular figures for every number**, timer, countdown and clock.
  Prose stays in a sans stack.
- **System font stacks only.** The app is offline and fetches nothing — no
  Google Fonts, no icon fonts, no CDN. If you want icons, they must be simple
  inline SVG shapes I can hand-write, or geometric CSS shapes.
- **Dark theme is the default**; a light theme must work from the same tokens.

## The problem you are solving

The current build is correct but unfriendly. Its faults, specifically:

1. **Nine panels on the home screen at once.** No visual hierarchy — the prayer
   countdown, which is the single most important thing, competes with seven
   other cards for attention.
2. **Everything is on one plane.** Three-column rows of dense lists, all at the
   same weight, all shouting equally.
3. **Rows are overloaded.** A single habit row carries a checkbox, a name, a
   seven-dot history strip, a streak count, a record count, and a button.
4. **Type is too small and too uniform.** 13px body, 10px labels, almost no
   scale contrast, so nothing reads as more important than anything else.
5. **Not enough whitespace.** Everything is 12–16px apart regardless of whether
   the things are related.

Fix these with **hierarchy and progressive disclosure**, not by deleting
features. Every capability listed below must still be reachable. Secondary
detail can move behind a tab, a hover, an expandable row, or its own page — but
it cannot disappear.

Aim for: **one obvious focal point per screen**, at most three or four regions
competing for attention, and a clear reading order.

## The screens

### 1. Today (home — the most important screen by far)

Opened on launch. In one glance it must answer four questions:

- **What prayer is next and how long do I have?** This is the hero. A live
  countdown like "Asr — 1h 42m left" plus the time the window closes and what
  comes next. Make it unmistakably the largest thing on screen. When a window is
  nearly closed it should read as urgent without turning into an alarm.
- **What is still unchecked today?**
- **How many days smoke-free?**
- **How long have I worked today?**

Must contain, somewhere: the five prayers with their times and states; the daily
habit checklist with a 7-day history strip and streak per habit; the avoid list
with a "clean" confirmation and a way to log a slip with a one-line note; the
pinned smoke-free counter with money saved; today's and this week's focused
time with a large START WORK button; sleep times with "Going to sleep" and
"Woke up" buttons; and today's score out of 100.

That is a lot. **Group it and rank it.** A single unified "today checklist"
merging prayers, habits and avoid into one scannable column is worth exploring,
with the rest demoted to a narrow secondary rail.

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

A start/stop timer. Big START WORK button; naming a session with autocomplete
from previous project names; a running stopwatch; STOP with an optional one-line
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
- Prefer flat surfaces and 1px borders over heavy shadows and gradients.
