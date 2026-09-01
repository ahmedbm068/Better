# Logo brief — paste everything below into your logo AI

---

Design a **logo mark** for a desktop app called **Better**.

**Mark only — no lettering.** Do not render the word "Better" or any text in the
image. The wordmark is set separately in a monospace typeface. Image models
misspell text, and a broken letterform would make the whole mark unusable.

## What the app is

A private, offline discipline tracker for one person. It records the five daily
prayers, a habit checklist, focused work sessions and sleep, then scores the day
out of 100. No accounts, no sync, no social features. It is opened five or six
times a day for about fifteen seconds, to answer "what have I still not done?"

The name means the better version of yourself — not a finished state, but the
standard you hold, day after day.

## The feeling

An **instrument**, not a consumer app. Think aircraft panel, measuring tool,
oscilloscope, a well-made caliper, a terminal. Calm, exact, unsentimental. It
should look like something that *measures* rather than something that
*celebrates*.

## Hard constraints

- **Flat vector geometry only.** No gradients, no drop shadows, no 3D, no
  bevels, no glow, no texture, no perspective.
- **One colour on one ground.** Amber `#E8A33D` on near-black `#121110`.
- **Square or near-square corners.** The whole product uses zero border radius.
- **It must survive 16 × 16 pixels in a single flat colour.** This is the hard
  one: the mark becomes a Windows tray icon at 16px, monochrome. Anything with
  thin strokes, fine detail, interior cut-outs or more than about four elements
  will turn to mush. Design it small first, then scale up.
- **No emoji, no mascot, no illustration, no character, no scene.**

## Clichés to avoid

Do not produce: an upward arrow, a rocket, a lightbulb, a checkmark, a mountain,
a staircase with a figure on it, an infinity loop, a human silhouette, a laurel
wreath, a shield, a generic swoosh, a gradient orb, a hexagon containing a
smaller shape, or overlapping translucent circles.

## Directions worth exploring

Give me distinct concepts, not variations of one idea:

1. **A datum line** — a reference line with a mark above it. The line is the
   standard; the mark is where you actually are.
2. **Ascending bars** — three or four flat bars of increasing height. The app
   already uses this shape for every chart, so the mark would come from the
   product's own language. Make it feel measured, not like a stock bar chart.
3. **A gauge or scale** — tick marks with one longer, emphasised tick. The idea
   of a reading taken.
4. **A plumb line** — a true vertical, the reference everything is measured
   against.
5. **A delta** — two states and the difference between them, expressed as pure
   geometry.

## What to hand back

For each concept:

1. The mark at large size, amber `#E8A33D` on `#121110`.
2. The same mark as a **flat black silhouette on white** — this is the real
   test; if it fails here it fails.
3. The mark rendered at **16 × 16**, single colour, so I can see whether it
   holds.

Four or five concepts is plenty. I would rather have five sharply different
ideas than twenty near-duplicates.

## Technical note for whoever implements it

The app generates its own icons in code, with no image library — it paints PNGs
from rectangles and circles (`scripts/gen-icons.mjs`). So a mark expressible as
a handful of rectangles, circles or straight-edged polygons can be implemented
exactly, at any size, with no asset file. If a concept needs curves, an SVG path
is fine. Anything painterly or photographic cannot be used.
