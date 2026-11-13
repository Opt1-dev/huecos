# Huecos

Huecos is a phone-first PWA that shows your **real free time** and organises your day, tasks, assignments (*rendus*) and notes. It started as Tomás's personal dashboard and is now shared, by invitation only, with classmates, coworkers, family and friends.

- **Frontend:** Vite + TypeScript + Preact, installable PWA, offline day view. UI in French, Spanish and English.
- **Backend:** Supabase (Postgres + RLS, magic-link Auth, Edge Functions, pg_cron, Realtime).
- **Hosting:** GitHub Pages, deployed by GitHub Actions on every merge to `main`.

| Path | Contents |
| --- | --- |
| `app/` | The PWA (`src/i18n` dictionaries, `src/lib` Supabase client and session, `src/ui` components). |
| `supabase/` | `config.toml`, `migrations/`, `tests/` (SQL assertions), `functions/` (Edge Functions, from Phase 1). |
| `.github/workflows/` | `ci.yml` (every push and PR) and `deploy.yml` (push to `main`). |

## Technical choices

- **Preact + signals:** React-like components at about 4 kB, which matters for a phone PWA.
- **No UI framework:** a few CSS variables give the light/dark themes; less to download and audit.
- **Typed i18n dictionaries:** French is the reference; a unit test fails if Spanish or English miss a key or a `{placeholder}`.
- **Publishable key in the browser:** it only identifies the project; every table is protected by RLS.
- **Invite-only through an Auth hook:** Postgres rejects any sign-up whose email is not in `public.invitations`, so nobody can create an account by calling the API directly.
- **`app_private` schema:** helpers, hooks and the admin list live in a schema the Data API does not expose.
- **Exact dependency versions + committed lockfile:** reproducible builds and less supply-chain risk.

## Local setup

Requirements: Node 22+, Git. Docker is only needed to run a local Supabase stack.

```bash
npm install
cp app/.env.example app/.env.local   # then fill in the project URL and publishable key
npm run dev                          # http://localhost:5173/huecos/
```

Useful scripts (run from the repository root):

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint on the app |
| `npm run typecheck` | TypeScript without emitting |
| `npm test` | Vitest unit tests |
| `npm run build` | Production build into `app/dist` |
| `npx supabase db start` | Local Postgres with all migrations (needs Docker) |
| `npx supabase migration new <name>` | Create a new migration file |

## Secrets and settings to create

Nothing secret is committed. Create these once.

### GitHub → repository Settings → Secrets and variables → Actions

**Secrets**

| Name | Where to get it |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access tokens. Prefer a **scoped** token limited to this project. |
| `SUPABASE_PROJECT_REF` | The project ref (the subdomain of the project URL). |
| `SUPABASE_DB_PASSWORD` | Supabase Dashboard → Project Settings → Database (reset it there if unknown). |

**Variables** (public values, used at build time)

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Dashboard → Project Settings → API Keys → publishable key (`sb_publishable_…`) |

### Supabase Dashboard (once, after the first deploy)

1. **Authentication → URL Configuration:** Site URL `https://opt1-dev.github.io/huecos/`; add redirect URLs `https://opt1-dev.github.io/huecos/` and `http://localhost:5173/huecos/`.
2. **Authentication → Hooks → Before User Created:** type *Postgres*, schema `app_private`, function `before_user_created`, enable.
3. **Invite the first admin** (SQL editor), then sign in with that email:
   ```sql
   insert into public.invitations (email, role) values ('you@example.com', 'admin');
   ```
   Admins can then add or remove invitations; members cannot see the list.

### GitHub Pages

Settings → Pages → Source: **GitHub Actions**. On a free GitHub plan, Pages only publishes from **public** repositories; a private repo needs GitHub Pro (or another host).

## Deploying

Merging a pull request into `main` runs `deploy.yml`:

1. lint, typecheck and unit tests;
2. `supabase db push` (new migrations) and `supabase functions deploy` (when functions exist);
3. build the PWA with the repository variables and publish it to GitHub Pages.

`ci.yml` runs on every branch push and pull request: the same app checks plus a job that starts a local Postgres, applies every migration and runs the SQL assertions in `supabase/tests/` (each file ends with `RAISE 'ALL_OK'` so nothing is kept).

## Data model (so far)

| Table | Purpose | Access |
| --- | --- | --- |
| `public.invitations` | Email allowlist (`member` or `admin`) | Admins only; read by the Auth hook |
| `public.settings` | One row per user: language, time zone, free-time window, minimum slot, modules | Owner only (read/update) |
| `app_private.admins` | Users who manage invitations | Not exposed |

A user's settings row is created automatically at sign-up; an invitation with role `admin` also makes the new user an admin.

## Scheduling rules

These rules drive the free-time computation. They are implemented as a pure, fully unit-tested TypeScript module in Phase 1. In the multi-user version each value below is a **per-user setting**; the numbers shown are Tomás's defaults.

- Times are **minutes since midnight in the user's time zone** (default `Europe/Madrid`), computed with `Intl`, never by adding hours to UTC.
- Free time is only counted between **08:00 and 00:00**. Time after midnight is shown but never counted as free.
- **Prácticas** (optional module): Monday to Friday, 09:00–13:00 (4 h a day), from 1 Oct 2026 to 1 Mar 2027, except blocked days (non-school and holidays). Hours done are tracked towards a 500-hour total.
- **Buffers** where nothing can be scheduled (shown as hatched "Trajet" zones):
  - 45 min before prácticas;
  - 1 h 15 after prácticas (leave, get home, eat);
  - 1 h 15 before every Amorino shift, including "Amorino Oniroma";
  - 30 min before and 30 min after each gym session.
- **Gym:** 4 days a week, usually 15:00–17:00; Monday and Thursday push, Tuesday and Friday pull.
- Overlapping busy blocks (events + buffers + timed tasks) are **merged first**.
- Free slots shorter than **15 min** are ignored.
- Output per day: free slots, total free, longest slot, busy total, next slot.
- **Auto-placement:** an urgent + important task without a time goes into the first free slot long enough within the next 48 h.
- Test cases: overlapping blocks, a shift ending after midnight, colliding buffers, a slot under 15 min, the DST change on 28 Mar 2027, an empty day, 48 h auto-placement with no slot available, a blocked day without prácticas.

## Roadmap

- **Phase 0:** repository, CI/CD, Supabase foundation (invites, settings), app shell with sign-in and languages.
- **Phase 1:** calendars and feed settings, `sync-calendars` Edge Function + pg_cron, scheduling engine, "Ma journée".
- **Phase 2:** "Rendus et notes" + import from the "Ma journée" dashboard.
- **Phase 3:** "Notes".
- **Phase 4:** Outlook corrections block (Microsoft Graph, per user).
- **Phase 5:** PWA polish (install, offline, icons) and deployment.
