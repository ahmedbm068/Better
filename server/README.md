# Better sync server

A Cloudflare Worker over D1. It holds one row per synced record, keyed by user,
table and wire key, and hands out a per-user sequence number that clients use as
a pull cursor.

## Why it is shaped this way

**Rows are stored as JSON, generically.** The server never asks a question about
the contents of a habit. It looks a row up by key, or streams everything past a
sequence. Mirroring ten tables would mean a migration on both sides every time a
column moved, and would buy nothing.

**`seq` is a counter, not a time.** A pull cursor has to be monotonic and
independent of any clock, which is exactly what `updated_at` is not.

**The merge rules live in `src/shared/sync.ts`,** shared with the desktop app. A
rule implemented twice is a rule that will eventually disagree with itself.

**Seeding happens here, not on a device.** A device seeds its starter lists
whenever they are empty, so a desktop install and a browser sign-in would each
invent their own six habits and sync both sets. The account seeds once.

## Endpoints

| Route | Does |
| --- | --- |
| `GET /health` | liveness |
| `GET /auth/github/start` | begins the handshake |
| `GET /auth/github/callback` | finishes it, returns or redirects with a token |
| `GET /me` | the signed-in user |
| `POST /auth/signout` | drops the session |
| `GET /changes?since=N` | rows after cursor N, oldest first |
| `POST /changes` | pushes rows, returns the new cursor |

All but health and auth need `Authorization: Bearer <token>`.

## Setup

```bash
npm install -g wrangler          # or npx wrangler
wrangler d1 create better        # put the id in wrangler.toml
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler dev                     # http://localhost:8787
wrangler deploy
```

Register the GitHub OAuth app with callback
`http://localhost:8787/auth/github/callback` for development. GitHub accepts a
localhost callback, so none of this needs a domain until you deploy.

## Tests

`npm run server-check` from the repository root runs the whole request pipeline
against better-sqlite3 instead of D1. D1 *is* SQLite, so the same code and the
same SQL run in both places; the only thing the tests stub is the OAuth
exchange, which would otherwise need GitHub.
