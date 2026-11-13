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
- **Invite-only through an Auth hook:** Postgres rejects any sign-up whose email is not in `public.invitations` and that doesn't carry the current sign-up link code, so nobody can create an account by calling the API directly.
- **Admin tab** (admins only): a **single-use sign-up link** (`…/huecos/?join=<code>`): one account per link, then it is used up (if two people use it at once, only the first gets an account); copy, share, replace or disable it. Anyone with it creates an account with email + password (8+ characters); the code is checked by the hook and removed from the new user's metadata. With *Confirm email* off, the account is active at once. The tab also lists every account (joined, last sign-in, admin, banned) and bans: a banned account can't sign in (sessions ended, `banned_until` set, data kept) and a banned email can't sign up; unban restores both. Admins can't be banned. **Supprimer** deletes an account for good with all its data (every Huecos table cascades from `auth.users`, Vault feed secrets included) and removes its invitation; admins can't be deleted.
- **Sign-in:** email + password, or an email link. *Mot de passe oublié ?* sends a reset email; the app then asks for a new password. Réglages → *Compte* changes the password: current password (checked first), then a new one of 8+ characters that must differ; *Pas encore de mot de passe, ou oublié ?* sends the reset email (for accounts created with an email link).
- **`app_private` schema:** helpers, hooks and the admin list live in a schema the Data API does not expose.
- **Exact dependency versions + committed lockfile:** reproducible builds and less supply-chain risk.

## Local setup

Add `?demo` to the dev-server URL (`http://localhost:5173/huecos/?demo`) to see the app with sample data without signing in; this mode does not exist in production builds.


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
4. **Calendar sync every 15 minutes** (once, SQL editor). The secret is generated inside the database and never leaves it: pg_cron sends it to `sync-calendars`, which checks it with `public.check_sync_cron_secret()` (service role only).
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'huecos_project_url');
   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'huecos_sync_cron_secret');
   ```
   The `huecos-sync-calendars` pg_cron job (created by a migration) does nothing until both Vault secrets exist. To rotate the secret: `select vault.update_secret(id, encode(extensions.gen_random_bytes(32), 'hex')) from vault.secrets where name = 'huecos_sync_cron_secret';`

### GitHub Pages

Settings → Pages → Source: **GitHub Actions** (already enabled). The repository is **public** because GitHub Pages on a free plan only publishes public repositories; nothing secret lives in the code: keys and passwords are GitHub secrets or Supabase settings, and every user's data is protected by RLS.

## Deploying

Merging a pull request into `main` runs `deploy.yml`:

1. lint, typecheck and unit tests;
2. `supabase db push` (new migrations) and `supabase functions deploy` (when functions exist);
3. build the PWA with the repository variables and publish it to GitHub Pages.

`ci.yml` runs on every branch push and pull request: the same app checks plus a job that starts a local Postgres, applies every migration and runs the SQL assertions in `supabase/tests/` (each file ends with `RAISE 'ALL_OK'` so nothing is kept).

## Data model

| Table | Purpose | Access |
| --- | --- | --- |
| `public.invitations` | Email allowlist (`member` or `admin`) | Admins only; read by the Auth hook |
| `public.settings` | One row per user: language, time zone, free-time window, minimum slot, modules, prácticas settings, last sync | Owner only (read/update) |
| `public.calendars` | A user's calendars: name, role, colour, buffers before/after, counts as busy, source (`feed` or `manual`), hidden event titles, work per deadline and max per day, feed host, last sync/error | Owner; `feed_secret_id` can't be written by the browser; `source` is set once; a manual calendar never has a feed |
| `public.deadline_done` | Deadline events marked done (no more work placed) | Owner, only for their own events |
| `public.notes` | Notes: title, optional subject (unlinked if the subject is deleted), text up to 5,000 characters, pinned. `updated_at` follows content edits only, not pinning | Owner; subject must be theirs |
| `public.subjects` | Subjects: name (unique per user, case-insensitive), colour slot 0–7 | Owner |
| `public.rendus` | Assignments: optional deadline event (one rendu per event, kept unlinked if the event goes), subject (can't be deleted while used), title, due date, state `todo|done|submitted|graded`, grade 0–10, note | Owner; event and subject must be theirs. Triggers keep it in step with `deadline_done`: a rendu past "todo" marks its deadline done, back to "todo" or deleted unmarks it; marking a deadline done moves its rendu to "done" (creating it, prefix removed, local due date) and unmarking moves "done" back to "todo" |
| `public.calendar_entries` | Entries of manual calendars: title, start/end time, ISO weekdays, from/until dates (same date = once). Expanded by the app, not stored per occurrence | Owner, only into their own manual calendars |
| `public.events` | Synced occurrences, unique on `(calendar_id, uid, start_at)` | Owner reads; only `sync-calendars` writes |
| `public.overrides` | Move or cancel an event in Huecos only | Owner, only on their own events |
| `public.tasks` | Tasks with quadrant (1 urgent+important … 4 neither), optional day/time, duration 15 min–4 h | Owner |
| `public.blocked_days` | Non-school days and holidays (no prácticas) | Owner |
| `app_private.signup_link` | The current sign-up link code (one row, or none = disabled) | Not exposed; read by the Auth hook; admin RPCs `get_signup_code`, `rotate_signup_code`, `disable_signup_code`, `am_i_admin` |
| `app_private.banned_emails` | Emails refused at sign-up | Not exposed; read by the Auth hook; admin RPCs `admin_list_users`, `admin_ban_user`, `admin_unban_user`, `admin_list_banned_emails`, `admin_ban_email`, `admin_unban_email`, `admin_delete_user` |
| `app_private.admins` | Users who manage invitations | Not exposed |
| `vault.secrets` | Encrypted calendar feed URLs and the cron secret | Service role only |

A user's settings row is created automatically at sign-up; an invitation with role `admin` also makes the new user an admin. Realtime is enabled on `tasks` and `overrides`.

## Rendus et notes

- **À rendre (14 prochains jours):** every deadline event ("Vencimiento de …", prefix removed, or any event of a *Deadlines* calendar) up to 14 days ahead, late ones included (red), plus rendus typed by hand that are still to do. The same deadline in two calendars shows once; identical deadlines in one calendar are numbered (1/3)… The subject is pre-filled when its name appears in the title (case and accents ignored, whole words). Changing the subject, state or note saves a real rendu linked to the event; once past "À faire" it moves to *Mes rendus*.
- **Mes rendus:** "Fait, non rendu", "Rendu, en attente de correction" (with a /10 grade box, typed, comma or dot: a valid grade moves it to "Corrigé") and "Corrigé" (collapsed by default, remembered per device). × deletes.
- **Notes par matière:** grade (0–10) by due date, one line per subject, dashed reference lines at 7.5 and 5, tooltip on hover/focus, legend with each subject's average. Colours are the 8 validated categorical slots (light and dark).
- **Nouveau rendu** and **Matières** (add, rename, colour, delete only when unused).
- Finishing a rendu frees its deadline's booked work time, and marking a deadline done in *Ma journée* moves its rendu to "Fait".

## Notes

- Form: title, optional subject, text (5,000 characters max, with a counter).
- List: pinned first, then most recently modified. Each note shows its title, subject, text (line breaks kept), "Modifiée le …", and Épingler / Modifier (inline: title, subject, text, Enregistrer / Annuler) / Supprimer.
- Search in title and text (case and accents ignored, every word must appear) and filter by subject, including "Sans matière".

## Calendar sync

- A user pastes a secret `.ics` link in **Réglages → Calendriers**. The `save-feed` Edge Function accepts only `https://` (or `webcal://`) links to public hosts: no credentials, no custom ports, no `localhost`/`.local`/private or reserved IPs (checked on the name and on every DNS answer, again after each redirect, max 3). It downloads the feed once (15 s, 5 MB max), checks it is iCalendar, then stores the URL **encrypted in Supabase Vault**. The browser only ever sees the host name.
- `sync-calendars` runs every 15 min from pg_cron (all users) or from the **Synchroniser** button (that user only, at most every 30 s). It expands each feed from 7 days ago to 60 days ahead with ical.js: RRULE/RDATE/EXDATE, moved occurrences (RECURRENCE-ID), all-day events, TZID with or without VTIMEZONE, UTC, `STATUS:CANCELLED`. It upserts the occurrences and deletes the ones that disappeared from the feed.
- Classification: titles starting with "Vencimiento de" and every event of a *Deadlines* calendar are deadlines (shown, never busy); "Entrega …" events of the *Main* calendar are study sessions (busy, shown as "Session d'étude"); all-day events never block time.
- Offline: the last loaded data is kept in IndexedDB, the day view works without network, and the header shows "Dernière synchro hh:mm" and "Hors ligne".
- Work before deadlines: a calendar can say how much work each of its deadlines needs (e.g. 6 h) and the most per day (default 2 h). For each deadline, earliest deadline first, Huecos books that time as "Travail" blocks in free time, starting the day before the deadline and going back one day at a time, earliest free time first in a day, pieces of at least 30 min, up to 60 days back. A piece longer than 4 h gets a 20-min break in the middle (booked as busy, so nothing else lands there). The plan doesn't depend on the current time, so it stays put and past blocks count as done. Auto-placed tasks go around it. Tap a work block or the deadline to see what is booked or missing, and mark the deadline done to free its remaining blocks.
- Hidden events: after a link is saved (or with **Chercher les événements répétés**), Huecos lists the titles used by several events of that calendar and asks which to hide. Days off and holidays (all-day or 20 h+ events, or titles like "Día libre", "Vacaciones", "Repos", "Congés") are pre-ticked. Hidden titles (compared without case or extra spaces) are neither shown nor counted as busy; they can be shown again from the calendar's settings. The feed itself is untouched.
- Manual calendars: when adding a calendar, choose **Manuel** instead of an .ics link, then add entries in Réglages: title, start and end time, and either some weekdays every week (presets: every day, Mon–Fri, weekend) from a date with an optional end date, or a single date. They block time like synced events, with the calendar's travel buffers. Tap an entry in the day or week view to edit or delete the whole series.
- Settings: each calendar is a collapsible section (colour, name, type, link or number of entries, last error); the one just added opens.
- Week view: "Ma journée" has a Jour / Semaine switch (remembered per device). The week runs Monday to Sunday with each day's free time, the week totals and the longest slot; tap a day to open it. On a phone the columns scroll sideways and start on today.

## Scheduling rules

These rules drive the free-time computation in `app/src/engine/schedule.ts`, a pure TypeScript module covered by `schedule.test.ts`; time-zone helpers are shared with the Edge Functions in `supabase/functions/_shared/tz.ts`. Each value below is a **per-user setting** (Réglages); the numbers shown are Tomás's values. Buffers belong to a calendar (`Trajet avant/après`), except prácticas, whose buffers are in the prácticas settings.

- Times are **minutes since midnight in the user's time zone** (default `Europe/Madrid`), computed with `Intl`, never by adding hours to UTC.
- Free time is only counted between **08:00 and 00:00**. Time after midnight is shown but never counted as free.
- **Prácticas** (optional module): Monday to Friday, 09:00–13:00 (4 h a day), from 1 Oct 2026 until the 500-hour total is reached, except blocked days (non-school and holidays). Each hour worked counts as **1.25 h** (setting *Heures comptées par heure travaillée*), so a 4 h day logs 5 h. With no fixed end date, the last day is computed from the start date, hours per day, that factor, weekdays and blocked days (100 days of 5 h → 17 Feb 2027 with no blocked day); a fixed end date can still be set, and Réglages warns when it leaves hours missing.
- **Buffers** where nothing can be scheduled (shown as hatched "Trajet" zones):
  - 45 min before prácticas;
  - 1 h 15 after prácticas (leave, get home, eat);
  - 1 h 15 before every Amorino shift, including "Amorino Oniroma";
  - 30 min before and 30 min after each gym session.
- **Gym:** sessions come from the gym calendar (usually 4 days a week, 15:00–17:00; Monday and Thursday push, Tuesday and Friday pull).
- Day column: 08:00 to 02:00 the next day; events as coloured blocks per calendar, buffers hatched "Trajet", free time as dashed green blocks without text. A buffer is drawn only where no event is, and free time never overlaps a buffer.
- Overlapping busy blocks (events + buffers + timed tasks) are **merged first**.
- Free slots shorter than **15 min** are ignored (a slot of exactly 15 min is kept).
- Output per day: free slots, total free, longest slot, busy total, next slot.
- **Auto-placement:** every task without a time is placed in free time, starts rounded up to 5 min. Order: urgent + important, then urgent, then important, then the rest; oldest first inside each.
  - *Urgent + important* and *urgent, not important*: the first free slot long enough within the next 3 days (today included). If none, the task is split in 2 halves (rounded to 5 min), on 2 different days when possible.
  - *Important, not urgent*: the longest free slot within 7 days of the day it was entered.
  - *Neither*: the first free slot long enough within 14 days of the day it was entered.
  - A task past its deadline gets the same span again from today. If nothing fits, the task says so.
- Test cases: overlapping blocks, a shift ending after midnight, colliding buffers, a slot under 15 min, the DST change on 28 Mar 2027, an empty day, auto-placement per quadrant (split in 2, deadlines, overdue tasks, nothing free), a blocked day without prácticas.

## Roadmap

- **Phase 0:** repository, CI/CD, Supabase foundation (invites, settings), app shell with sign-in and languages.
- **Phase 1:** calendars and feed settings, `sync-calendars` Edge Function + pg_cron, scheduling engine, "Ma journée".
- **Phase 2:** "Rendus et notes" (done; no import from "Ma journée", by choice).
- **Phase 3:** "Notes" (done).
- **Phase 4:** Outlook corrections block (Microsoft Graph, per user).
- **Phase 5:** PWA polish (install, offline, icons) and deployment.
