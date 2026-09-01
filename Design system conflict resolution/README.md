# Handoff: "I'm HIM" — desktop UI redesign

## How to use this with Claude Code

1. Copy this whole `design_handoff_im_him/` folder into the root of your repo.
2. Open the repo in VS Code and start Claude Code.
3. Paste this prompt:

> Read `design_handoff_im_him/README.md` in full, then the reference file for the
> screen we're doing. Adopt `design_handoff_im_him/tokens.css` as the app's token
> layer first. Then rebuild one screen at a time in our existing React +
> TypeScript + Tailwind components — match the spec exactly, don't port the
> reference HTML or its inline styles. Start with Today. Show me a diff before
> moving to the next screen.

Do the tokens commit on its own, before any screen. Every screen depends on it,
and it fixes two of the five faults by itself.

## Overview

A private, offline discipline tracker for one person (Windows/Electron, 1400×880,
min 940×640). This redesign fixes five named faults in the current build: nine
competing panels on the home screen, everything on one visual plane, overloaded
rows, a flat type scale, and uniform 12–16px spacing regardless of relationship.
Nothing was deleted — detail moved behind hierarchy, expandable rows and
secondary panes.

Six screens are designed: **Today, Calendar, Week, Day detail, Work, Sleep**.
Not yet designed: Stats, Weekly review, Lists, Settings.

## About the reference files

The `.dc.html` files are **design references, not production code**. They are
self-contained prototypes that render the intended look and behaviour — live
clocks, working checkboxes, a running stopwatch, real chart geometry — so intent
is visible rather than inferred. Open one in a browser to see it.

Recreate the screens in the existing codebase using its established component
patterns. The only file meant to be adopted literally is `tokens.css`.

Read a reference file when you need an exact measurement; read this README for
everything else.

## Fidelity

**High.** Colours, type sizes, spacing, borders and interaction states are final.
Every value below is exact.

---

## 1. Design tokens

Adopt `tokens.css`. It defines two themes on one contract: `[data-app]` is dark
(the default), `[data-app][data-theme='light']` overrides it. In the real app,
move these to `:root` and `[data-theme='light']`, and expose them to Tailwind v4
through `@theme` so utilities resolve to the variables instead of literals. No
component should contain a hex value after this work.

### Colour — dark (default)

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#121110` | window ground, behind panels |
| `--panel` | `#191817` | every panel surface |
| `--panel2` | `#201e1c` | row hover, expanded row, active nav item |
| `--line` | `#2a2825` | 1px hairline between rows and panels |
| `--line2` | `#3b3833` | 2px section rule, control borders |
| `--text` | `#eeebe6` | primary ink |
| `--text2` | `#a49d95` | secondary ink |
| `--text3` | `#837c74` | labels, units, muted meta |
| `--accent` | `#e8a33d` | the single accent |
| `--accent-ink` | `#17130d` | ink on an accent fill |
| `--done` | `#7dae77` | done / clean |
| `--missed` | `#c06a5e` | missed / slip / out of tolerance |
| `--grace` | `#7f97b5` | grace day; also the sleep series in charts |
| `--wait` | `#3b3833` | unfilled track behind any bar |

### Colour — light

| Token | Value |
| --- | --- |
| `--bg` | `#f2f1ef` |
| `--panel` | `#ffffff` |
| `--panel2` | `#f7f6f4` |
| `--line` | `#e2dfda` |
| `--line2` | `#cbc7c0` |
| `--text` | `#1a1917` |
| `--text2` | `#5c5750` |
| `--text3` | `#6f6a63` |
| `--accent` | `#a8680b` |
| `--accent-ink` | `#ffffff` |
| `--done` | `#3f6a3a` |
| `--missed` | `#98453b` |
| `--grace` | `#42597a` |
| `--wait` | `#d8d4ce` |

Light is not a lightened dark — the accent darkens to `#a8680b` and the three
semantics darken so they clear 4.5:1 on white at 10px. Do not reuse dark values.

Floors that must hold in both themes, measured on `--panel`: `--text2` ≥ 6.5:1,
`--text3` ≥ 4.3:1, `--missed` ≥ 4.6:1, `--done` ≥ 6.9:1, `--accent` ≥ 4.5:1.

### Type

Two stacks, no web fonts, nothing fetched over the network:

```
--sans: -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
--mono: ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, "SF Mono", monospace;
```

Rule: **every number, time, duration, countdown, clock and score is mono**; prose
and item names are sans. `font-variant-numeric: tabular-nums` is set globally in
`tokens.css` so columns of figures align.

| Role | Size | Weight | Tracking | Family |
| --- | --- | --- | --- | --- |
| Hero countdown / stopwatch | 66–82px | 500 | −0.03em | mono |
| Hero subject (prayer name) | 38–40px | 600 | −0.01em | sans |
| Screen figure (day score, sleep span) | 46–54px | 500 | −0.02em | mono |
| Panel figure (score, counter) | 31–36px | 500 | −0.02em | mono |
| Cell figure (calendar day, week score) | 20–27px | 500 | −0.01em | mono |
| Sidebar clock | 22px | 500 | — | mono |
| Screen title | 16px | 600 | 0.02em | sans |
| Item name | 13.5px | 400 | — | sans |
| Nav item | 12.5px | 400 / 600 active | — | sans |
| Panel header | 11px | 700 | 0.16em | sans, uppercase |
| Section kicker | 10px | 600–700 | 0.13–0.18em | sans, uppercase |
| Value / meta | 11–13px | 400–500 | — | mono |
| Micro label | 10–10.5px | 400–700 | 0.06–0.15em | mono, uppercase |

**Nothing renders below 10px.** Density comes from tight rows and reduced
letter-spacing, never smaller glyphs. Hero-to-smallest-label ratio is about 8:1 —
that ratio is the fix for the flat type scale.

### Spacing

4px base; used steps 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 16, 18, 22, 24. Gaps
carry meaning — this is the fix for uniform spacing:

- 3–5px — inside one unit (a label above its value, dots in a strip)
- 7–9px — between related items in a group
- 10px — between panels
- 13–16px — between groups inside a panel
- 18–24px — panel padding
- 1px `--line` separates rows; 2px `--line2` separates sections. Related things
  get a gap, unrelated things get a rule.

Layout constants: sidebar `188px`; main padding `16px 18px 0`; footer status bar
`24px` above an 8px top rule; top strip `44px`; right rail `296–416px`.

### Radius, borders, depth

`--radius: 0` everywhere, including inputs, buttons and chips. Borders: 1px
`--line` for rows, 2px `--line2` for sections, 2px `--accent` for the current
item. **No shadows, no gradients** — depth is borders plus the
`--bg` / `--panel` / `--panel2` ground steps. The single permitted tint is
`color-mix(in oklab, var(--accent) N%, var(--panel))` for score intensity.

---

## 2. Reusable components

Build these once; every screen is assembled from them.

### Panel
`background: var(--panel); border: 1px solid var(--line)`. Optional header:
`padding: 12px 16px 11px`, `border-bottom: 2px solid var(--line2)`, an
11px/700/0.16em uppercase title left, a mono summary figure right. The panel
holding the live or current thing gets `border-top: 2px solid var(--accent)`.

### Button
Four variants, zero radius, **labels flush left** (never centred):

- **Primary** — `background: var(--accent)`, `color: var(--accent-ink)`, height
  36–46px, 12–14px / 700 / 0.14–0.16em, `padding: 0 14px`, hover `opacity: .88`.
  At most one per screen.
- **Secondary** — transparent, `1px solid var(--line2)`, `color: var(--text2)`,
  height 31–34px. Hover: border → `--accent`, ink → `--text`.
- **Micro** — height 19–23px, `padding: 0 8px`, 10px / 0.1em mono, ink
  `--text3`. Destructive variants hover to `--missed`.
- **Stepper** — 26×24px, mono `‹` / `›`.

A running/active primary inverts to the secondary treatment, so the accent never
does two jobs at once.

### Checkbox row
Height 30–34px, `padding: 0 16–20px`, `border-bottom: 1px solid var(--line)`,
`gap: 12–14px`, hover `background: var(--panel2)`. Box is 15–16px, 1.5px border:

| State | Fill | Border | Glyph |
| --- | --- | --- | --- |
| done | `--done` | `--done` | `✓` in `--panel` |
| open window | transparent | `--accent` | — |
| missed | transparent | `--missed` | — |
| grace day | transparent | `--grace` | `G` in `--grace` |
| upcoming | transparent | `--line2` | — |

A grace day is **never** a checkmark and never green.

### Stat tile
Column inside a bordered strip, `border-left: 1px solid var(--line)`,
`padding: 13px 18px 15px`. Micro label in `--text3`, a 31px mono figure, its unit
at 11px `--text3`, then optionally a 7-bar shape and a comparison figure. **A tile
with no data shows `—` in `--text3`, never `0`.**

### Streak badge
Mono: current streak in `--text` immediately followed by ` / record` in
`--text3`, one 12px unit right-aligned in a 60–64px column. A broken streak still
shows the record — the evidence is never erased.

### Day strip (7-day / 30-day)
7×7px cells (5×11px in the 30-day form), `gap: 3px`, 1px border. done = filled
`--done`; missed = hollow `--missed`; grace = hollow `--grace`; untracked =
hollow `--line2`.

### Chart frame
Charts are flat SVG or divs — no chart library needed, no rounded caps, no
animation on load. Bars sit in their own `flex:1` track with labels **outside**
the measured track (otherwise flexbox steals height and tall bars flatten to the
same size — this was a real bug). Every bar gets a `--wait` ground so the
remainder is visible. Series colours: `--accent` for the current/latest item,
`--text2` for history, `--missed` for out-of-tolerance, `--grace` for sleep.

### Achievement marks
Two hand-written inline SVGs at 16–17px, four paths total. Do not substitute icon
font glyphs or emoji.

- **All five prayers** — a mihrab arch on its base line, stroke `--done`:
  `<path d="M3 14.5V7.5a5 5 0 0 1 10 0v7"/><path d="M1 14.5h14"/>`
- **Smoke-free** — a struck-through cigarette, stroke `--accent`:
  `<path d="M1.5 11h9.5"/><path d="M12.6 11h2"/><path d="M3 14.5 13.5 4"/>`

### Sidebar
188px, `--panel`, `border-right: 1px solid var(--line)`. Brand at top
(14px/700/0.2em) over a "LOCAL · OFFLINE" micro label. Nine items in three
labelled groups — **NOW** (Today), **HISTORY** (Calendar, Week, Work, Sleep,
Stats, Review), **SETUP** (Lists, Settings) — each 32px, `padding: 0 18px`, with a
mono meta figure right-aligned (today's score, the week number, today's focused
time). Active item: `--panel2` ground, `border-left: 2px solid var(--accent)`,
weight 600, meta in `--accent`. Footer: date micro label, 22px live clock,
"TUNIS · UTC+1".

### Footer status bar
24px, above an 8px `--line` top rule, all 10.5px mono `--text3`: file path
`~/imhim/data.json`, a save/record state, then right-aligned key hints.

---

## 3. Screens

### Today — `TodayScreen v2.dc.html`
The home screen, and the answer to "nine competing panels". Four tiers:

1. **Status bar** (44px) — live score with a 14-day sparkline, four counters,
   rollover offset, grace days remaining.
2. **Hero** — the open prayer window or the next arrival: kicker, prayer name at
   38px, countdown at 66px mono in `--accent`, then window-elapsed progress. Turns
   `--missed` when under 20 minutes remain. Beside it, the day rail: coloured
   window bands per prayer, sunrise as a bare tick, a NOW marker, and prayer
   labels in an **evenly divided five-cell row beneath** — never positioned by
   time, or close prayers collide.
3. **Unified checklist** — prayers, habits and avoid merged into one scannable
   column, 15 rows, grouped by kickers not panels. Prayer rows carry a
   window-elapsed bar and logged time. Habit rows expand on name click to streak,
   record, month total, applicable weekdays, grace status and a 30-day strip.
   Avoid rows carry a LOG SLIP micro button; the pinned nicotine row carries PIN.
4. **Right rail** (296px) — score breakdown, pinned smoke-free counter with money
   saved, focused time with 7-day bars and the start button, sleep with a
   14-night chart. Everything demoted here is real but secondary.

### Calendar — `CalendarScreen.dc.html`
Month grid, 7 columns × 5 or 6 rows — compute `Math.ceil((firstWeekday + daysInMonth)/7)*7`
slots so a five-week month doesn't leave a dead row. Each cell: day number 27px
mono top-left, the two achievement marks below it, score 20px mono bottom-right,
SLIP / GRACE micro labels, and an editable `+ note` field along the bottom.
Cell ground is `color-mix(in oklab, var(--accent) score*0.2%, var(--panel))` so
the month reads as a field of intensity. Today: 2px `--accent` on top and left
edges plus a TODAY label. A 152px **week summary column** on the right, aligned
to the grid rows: average score, prayer %, focused hours.

**Untracked days** (before install): no marks, no score, no note field, the word
UNTRACKED once per run — not on every cell. An untracked month shows `—` in all
four header tiles and "NO DATA BEFORE 16 JUL 2025" in the footer. Grace is one
per month **per habit** — six habits, so the denominator is `/6`.

### Week — `WeekScreen.dc.html`
Four stat tiles (avg score, prayers, focused total, avg sleep), each with a 7-bar
week shape and a vs-last-week delta. Below, seven day columns: score 36px mono,
achievement marks, a **stacked component bar** (prayers 25 / habits 25 / avoid 20
/ sleep 15 / work 15, 1px gaps, legend in the top bar) so you see what cost the
points, then the five prayers with times, the six habits, focus and sleep, slips,
and a note field. Best and worst day of the week are labelled outright.

### Day detail — `DayDetailScreen.dc.html`
Score at 54px left of a full-width strip, with all five components broken out
beside it — bar, points, and what produced them ("3 of 5 prayed", "1:47
focused"). Three columns below: prayers (due, logged, state) and avoid (a slip
carries its time and a one-line note); habits (grace days marked, logged times)
and work sessions (spans, durations); sleep versus target, and the note.
**Past days are read-only except the note** — the top bar says so.

### Work — `WorkScreen.dc.html`
Stopwatch at 82px is the focal point. Name the session in the field beside it —
typing filters an autocomplete of previous projects with lifetime totals — then
START WORK. The panel takes an `--accent` top rule while running, a stop-note
field appears, and STOP writes a row into today's log with span, name, duration
and note, renameable inline and deletable. Empty state is explicit, not a blank
panel. TOTALS toggles 12 weeks / 12 months; HOURS PER PROJECT ranks the last 90
days with each project's share.

### Sleep — `SleepScreen.dc.html`
Last night as the hero: `23:52 → 06:41` and `6:49` at 46px, with bedtime and wake
each stated against target. Two buttons opposite — "Going to sleep" sets a
pending state and lights "Woke up". Below them the manual edit for nights a
button went unpressed: two time fields and APPLY, which recomputes the charts.
The 30-night chart is two readings on one x-axis: bedtime drift as dots over a
green ±30m tolerance band with the target dashed through it, and duration bars
beneath, `--missed` under 6:30. **Bedtime is a vertical scale** — its three time
marks sit in a 52px left gutter aligned to the y positions they describe; the
duration chart is indented to the same gutter so both share one date axis.

---

## 4. Rules that hold across every screen

- **One accent.** `--accent` marks the live thing and the primary action, nothing
  else. If two things on a screen are amber, one is wrong.
- **Never fake a zero.** Untracked, upcoming and no-data all render `—` in
  `--text3`. A day before install is not a failure and must not look like one.
- **Grace days are their own state** — `--grace`, hollow box, `G`, labelled
  "GRACE DAY". Completing the habit releases the grace day.
- **A missed prayer window is flat and quiet** — desaturated `--missed`, the word
  MISSED, no icon, no emphasis.
- **Derive, never duplicate.** A score is computed from its five components; the
  headline follows the rows. Two figures on screen must not be able to disagree.
- **Label the basis of every average** — "AVG / DAY · MONTH", "AVG / ACTIVE DAY".
- **Focus rings are themed**: `:focus-visible { outline: 2px solid var(--accent);
  outline-offset: 2px; }`. Never the browser default.
- **Nothing below 10px, no rounded corner, no shadow, no gradient, no emoji.**

## 5. Files in this folder

| File | What it is |
| --- | --- |
| `tokens.css` | The token layer. Adopt this literally. |
| `TodayScreen v2.dc.html` | Today reference |
| `CalendarScreen.dc.html` | Calendar reference |
| `WeekScreen.dc.html` | Week reference |
| `DayDetailScreen.dc.html` | Day detail reference |
| `WorkScreen.dc.html` | Work reference |
| `SleepScreen.dc.html` | Sleep reference |

Open any reference in a browser to see it live. Ignore `support.js` if it isn't
present — the references still render their layout without it.
