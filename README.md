# Better

A personal discipline and life tracker for Windows. Fully offline: one SQLite
file on your machine, no account, no server, no telemetry.

## Running it

```bash
npm install      # also fetches the prebuilt SQLite binary and generates icons
npm run dev      # development, with hot reload
npm run dist     # produces release/Better-Setup-1.0.0.exe
```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm test` | Unit tests for the prayer window machine, rollover, scoring, streaks |
| `npm run smoke` | End-to-end test of the database and services, under Electron |
| `npm run migration-check` | Upgrades a hand-built v1 database and checks nothing was lost |
| `npm run sync-check` | Two databases stand in for two devices and exchange changes |
| `npm run server-check` | The sync server end to end, on SQLite instead of D1 |
| `npm run syncservice-check` | The desktop sync cycle, against the real server code |
| `node scripts/typing-check.mjs` | Regression check: modal keeps focus while typing |
| `node scripts/reorder-check.mjs` | Regression check: drag/keyboard reorder persists |
| `npm run typecheck` | Type-checks the main process and the renderer separately |
| `npm run build` | Typecheck + tests + bundles (no installer) |
| `npm run dist:dir` | Unpacked build in `release/win-unpacked`, for quick checks |
| `npm run dev:web` | The web client, on http://localhost:5174 |
| `npm run build:web` | Static web bundle in `out/web` |

## How it is put together

```
src/
  shared/     pure logic and types, imported by every layer and by the tests
    prayer.ts   the prayer window state machine
    day.ts      day rollover (the day starts at Fajr, not midnight)
    score.ts    the daily score out of 100
    streaks.ts  streak rules, including grace days
  main/       Electron main: database, services, IPC, tray, notifications
    db/         schema, migrations, typed repositories
    services/   prayer times, day assembly, work, sleep, stats, review, backup
  preload/    the contextBridge surface — the renderer's only door out
  renderer/   React UI
```

The renderer has no database access and no clock authority. It asks the main
process, which owns every rule.

## The decisions worth knowing

**Prayer windows.** Each prayer is valid only inside its own window: Fajr runs
until *sunrise* (not until Dhuhr), and Isha runs until the next morning's Fajr.
A window that closes unchecked is missed, permanently — the guard lives in
`dayService.checkPrayer` and there is no path around it. Checking off a prayer
outside its window is refused, not silently ignored.

**Prayer times are snapshotted.** The times for a day are computed once, the
first time that day is touched, and stored. Changing your coordinates or
calculation method later affects today and the future only; days you already
lived keep the times you were actually judged against.

**The day rolls over at Fajr.** Between midnight and Fajr you are still in the
previous logical day. That is what makes a 01:00 bedtime belong to the day that
just ended, and it lets the Isha window sit inside a single day.

**Days before you installed it are not judged.** The first run records a
tracking start date. Earlier days show blank in the calendar and score nothing —
you cannot miss a prayer the app was not yet watching.

**Streaks are not all-or-nothing.** Every habit and avoid item keeps its
all-time record next to the current streak, so a broken streak never erases the
evidence. Days an item does not apply to are skipped, not broken. Each habit
gets one grace day per calendar month that keeps a run alive — it is visibly
marked as a grace day and does not add to the count, so the number stays honest.
A grace day can be spent on today or yesterday, since a break is usually noticed
the next morning.

**A grace day protects the streak, not the score.** Using one still shows up in
the day's score.

**Recording a prayer the app never saw.** The guard has no in-app override, by
design. For the genuine cold-start case — you prayed before the app was
installed or while it was closed — there is a deliberate out-of-band tool:

```bash
npx esbuild scripts/backfill-prayer.ts --bundle --platform=node \
  --format=cjs --external:electron --external:better-sqlite3 \
  --alias:@shared=./src/shared --outfile=out/backfill.cjs
npx electron out/backfill.cjs                        # dry run, shows the day
APPLY=1 PRAYER=fajr AT=04:30 npx electron out/backfill.cjs
```

It writes the mark directly rather than through `checkPrayer`, and defaults to a
dry run. The friction is the point: it should never be as easy as a click.

**What can be edited after the fact.** Prayers: never. Habits and the avoid
list: the current day only. Sleep times and work sessions: yes, because those
buttons get forgotten. Day notes: always, on any day.

**Rows carry an identity, not just a row number.** Habits, avoid items and work
sessions each have a `uid` (UUIDv7) alongside the local integer id. The integer
stays the primary key and every foreign key still uses it, so nothing above the
repositories changed; the `uid` is what will cross the wire once sync exists,
because two devices creating a habit offline would otherwise both call it id 7.
Sleep sessions have no `uid` on purpose — their `date` is already unique and is
the identity two devices would agree on anyway.

**Deleting is a write.** Every syncable table has `deleted_at`, and deletes set
it rather than removing the row: a row deleted outright on one device would
simply come back on the next pull from another. Reads exclude tombstones, and
writing the same key again revives it. Deleting a habit tombstones its logs
explicitly, since the foreign key cascade cannot fire for a row that still
exists.

**Prayer time snapshots are never overwritten.** Unlike every other table they
carry no `updated_at` and no tombstone. Two devices that computed a day
differently — because you travelled — must not overwrite each other, or the day
you were actually judged against would be rewritten. First write wins.

**Avoid items are clean by default.** A day only counts against you when a slip
was actually logged. Nothing is inferred from silence.

**No guilt language.** Missed is stated as "missed" and nothing more. There are
no shame screens and no motivational copy anywhere in the app.

## Scoring

| Component | Points |
| --- | --- |
| Prayers | 40 (8 per prayer done in time) |
| Habits | 25, proportional to applicable habits completed |
| Avoid list | 20, proportional to items with no slip |
| Sleep on target | 10 (both ends within tolerance) |
| At least one work session | 5 |

A category with nothing to track is not held against the day.

## The web client

The same app in a browser, built from the same renderer. It is not a second
implementation: `src/web` opens a SQLite database compiled to WebAssembly,
installs it as the handle every repository already talks to, and runs the same
services. The prayer windows, the day rollover, the score and the streak rules
exist once.

That is the reason it works this way. Answering `getDay` on the server would
have meant porting every rule to the Worker, and then two copies of them to keep
in step.

```
src/web/
  sqljs.ts    a DatabaseType over sql.js — synchronous, which the services need
  persist.ts  the database, snapshotted into IndexedDB on a debounce
  api.ts      ImHimApi, answered in the tab instead of over IPC
  boot.ts     open, migrate, claim a token, pull, mount
```

Signed out it is a usable local app, so it can be tried before signing up.
Signed in it pulls the account before the first paint.

The browser copy is a cache, not the record. Clearing site data loses it, and
the server is what makes that survivable — which is also why the download is
still worth offering.

## Sync

Optional, and off until you sign in. The local SQLite file stays the source of
truth: every write lands there first, and a cycle only moves what is already
recorded, so a device with no network is slightly behind rather than broken.

Push runs before pull, so local work reaches the server before this device
takes anything that might supersede it.

Signing in opens the real browser, never an Electron window — a window the app
controls could read what is typed into it. The server sends the token back to a
loopback port the app is listening on, so the provider only ever knows the
server URL.

Signing out, or a session the server has expired, forgets the account and the
cursor but touches no data. Local rows stay queued and go up again after the
next sign-in.

The token lives in `sync_state`, not in `settings`, because settings are written
into every backup and a session token does not belong in an export file.

## Backup

`Settings → Backup` exports every table as JSON, or as one CSV per table. The
JSON export is what restores. Importing replaces everything currently stored and
copies the existing database aside first, so a bad restore is always recoverable
from disk. This is the only backup the app has — take one regularly.

The database lives at `%APPDATA%/Better/data.sqlite`.

The app was previously called *I'm HIM*. On first launch after the rename it
carries an existing `%APPDATA%/I'm HIM/imhim.sqlite` over with `VACUUM INTO`,
leaving the original untouched. Backups written under the old name still import.

## Windows integration

- Closing the window hides to the tray so prayer notifications keep working;
  quit from the tray menu. Toggleable in Settings.
- The tray tooltip shows the live countdown to the current window closing.
- `Ctrl+Shift+H` shows or hides the window from anywhere.
- `Alt+1` … `Alt+9` switch views.
- Launch on startup is off by default; when on, the app starts hidden in the
  tray.

## Dependency notes

- **Electron is pinned to 42** and **better-sqlite3 to 12.11.1**: that pair has a
  published prebuilt binary (ABI 146), so `npm install` never needs Visual Studio
  build tools. Bumping either one means checking that a matching prebuild exists,
  or accepting a source build.
- `adhan` sits in `devDependencies` on purpose. electron-vite externalises
  everything in `dependencies`, so only the native module belongs there;
  everything else is bundled.
- Icons are generated at install time by `scripts/gen-icons.mjs`, which writes
  PNGs with no image library. No fonts or assets are fetched at runtime.
