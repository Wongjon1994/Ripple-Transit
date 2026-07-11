# Ripple Transit

**Real-time urban mobility intelligence for Singapore.**

Ripple Transit combines live transit routing (OneMap) with an intelligence layer
that answers a question no other app does well: _can you actually catch this bus?_
Every bus leg is scored against live LTA arrival data and how long it takes you to
walk to the stop — surfaced as a green **OK** / amber **TIGHT** / red **MISS** badge,
with catchable alternatives one tap away.

> Design language follows _The Daily Ripple_: minimalist, typography-driven, data-focused.
> The original spec package lives in `specifications/` and `MASTER_PROMPT.md`.

---

## Stack (as built)

| Layer | Choice |
|-------|--------|
| Frontend | React 19 + Vite 6, Wouter, Tailwind CSS 4, Leaflet (OneMap tiles) |
| Data layer | tRPC 11 + TanStack Query, superjson, end-to-end types |
| Backend | Express 4, tRPC 11 |
| Database | Drizzle ORM on **libSQL/SQLite** (local file; deploy to Turso) |
| Auth | Email + password (bcrypt) with httpOnly cookie sessions |
| Tests | Vitest |

**Deviations from the original spec** (which assumed the Manus platform), agreed up front:

- **MySQL/TiDB → libSQL/SQLite.** One dialect for zero-setup local dev and cloud
  (Turso) deploy. Same 6 tables + `sessions`, semantics preserved.
- **Manus OAuth → email + password.** Self-contained, no external provider.

---

## Quick start

```bash
npm install
cp .env.example .env      # then fill in API keys (see below)
npm run db:migrate        # create the SQLite schema
npm run db:seed           # seed MRT lines + a dev user
npm run dev               # server :3001 + client :5173 (Vite proxies /api)
```

Open http://localhost:5173.

**Dev login** (from the seed): `dev@ripple.transit` / `password123`

### Single-port production-style run

```bash
npm run build             # build client + emit server
npm run preview:serve     # Express serves API + built client on :5173
```

---

## Environment (`.env`)

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | `file:./data/ripple.db` locally, or a `libsql://` Turso URL |
| `SESSION_SECRET` | signs the auth cookie |
| `ONEMAP_TOKEN` | pre-issued 3-day JWT; `ONEMAP_EMAIL`/`ONEMAP_PASSWORD` enable auto-refresh |
| `LTA_ACCOUNT_KEY` | LTA DataMall AccountKey (bus arrivals, stops) |
| `HERE_API_KEY` | HERE autosuggest fallback; `HERE_MONTHLY_CAP` (default 29,950) |

`.env` is gitignored — never commit real keys. See `.env.example` for the template.

---

## Scripts

| Script | Does |
|--------|------|
| `npm run dev` | server + client with hot reload |
| `npm run db:migrate` / `db:seed` / `db:reset` | schema + seed lifecycle |
| `npm run db:generate` | regenerate migration SQL after a schema change |
| `npm test` | run the Vitest suite |
| `npm run typecheck` | typecheck client + server |
| `npm run build` | production build |

---

## Project structure

```
client/src/          React app (pages, components, tRPC client, theme)
server/
  routers/           tRPC routers (auth, onemap, lta, mrt, here, saved…, settings)
  services/          external API + domain logic (onemap, lta, here, feasibility)
  db/                Drizzle client + helpers
  index.ts           Express + tRPC entry
drizzle/             schema, migrations, migrate + seed scripts
shared/              types shared across client & server
specifications/      original spec package  ·  mockups/  visual references
```

---

## Status

**Working end-to-end today** (verified against live OneMap / LTA / HERE APIs):

- Project scaffold, secrets, DB schema + migrations + seed (Phases 1–2)
- Email/password auth, sessions, protected/admin tRPC procedures (Phase 3)
- OneMap token lifecycle, search **with HERE fallback**, transit routing (Phase 4)
- LTA bus arrivals / stops / nearby; MRT statuses + operating hours; HERE usage cap (Phases 5–7, backend)
- Map-first UI: Leaflet + OneMap tiles, address autocomplete, route results with
  legs, colored polylines, and **live bus-feasibility badges + alternatives** (Phases 8–10, 12 core)

**Remaining / in progress:** user-facing CRUD screens for saved locations & favourite
routes, settings page, hourly MRT/token refresh jobs, and broader test coverage
toward the 65+ target (feasibility engine is covered — 11 tests).

---

## License

Private project.
