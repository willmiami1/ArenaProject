# Destiny Ranch Arena

A public team roping event website and responsive Arena Command staff manager
designed to run as an embedded web app inside a Wix site.

## Features

- Parent arena events with independent roping competitions underneath
- Event and active-roping switching
- Competition setup for Draw Pot, Pick Only, Pick and Draw, and Round Robin
- Per-roping team handicap totals and highest individual contestant handicap eligibility
- Free spectator Steer-or-Cowboys predictions with admin cutoffs, round leaderboards, and LED top-three names
- Automatic draw-pot entries from every Pick and Draw picked team
- Format-aware individual or team registration
- One Round 1 run per partner pairing by default, with optional repeat partner runs
- Automatic partner draws, round-robin schedules, redraw history, and draw locks
- Contestant roster with header/heeler positions
- Downloadable contestant backups with validated JSON and delimited TXT database imports
- Simplified contestant profiles without position, membership, or category fields in the roster UI
- Team entry and randomized draw order
- Run desk for times, penalties, no-times, and notes
- Round 1 ride-in team entry directly from the Run Desk
- Roll and unroll teams that are not ready, moving them behind the active running order
- Round-by-round cumulative times and Short Go announcer targets for the average and first place
- Aggregate Results Standings ranked by total official time with completed-round counts
- Full-screen 16:9 LED leaderboard with contestant portraits, live aggregate standings, a Now Roping banner, final-round target times, next-team display, and same-browser data preview
- Permanent sidebar LED Screen shortcut for the active roping and latest generated round
- Full workspace backup and restore for events, teams, registrations, results, and contestants
- Wix-backed contestant portal with email and four-digit PIN login for personal entries, draws, teams, and results
- Public event calendar, competition pages, publication-gated official results, and authenticated online entry
- Future-event contestant account creation with server-side validation and hashed four-digit PIN credentials
- Configurable Short Go limits that advance only the fastest qualified teams
- Final-round running orders listed from slowest qualifier to fastest qualifier
- Live standings, round-robin points, and event overview
- Configurable fees, purse calculations, and payout splits
- Check-in, wait list, scratches, CSV/Excel exports, and printable PDF reports
- Reports workspace with 27 event and competition report templates
- Searchable, sortable, paginated report previews with configurable filters and columns
- Professional print/PDF layouts, real `.xlsx` workbooks, CSV, HTML downloads, and email actions
- Financial, payout, draw, results, stock, contestant, team, judge, and arena-statistics reports
- Role-based report access for administrators, producers, secretaries, announcers, and read-only users
- Searchable report history with one-click regeneration and saved per-role column preferences
- Browser-based persistence with no server required

## Development

```bash
npm install
npm run dev
```

## Wix deployment

Run `npm run build`, host the generated `dist` folder on any static web host,
then add it to Wix with **Embed Code > Embed a Site** using the hosted URL.
The app is responsive and uses relative asset paths for embedded hosting.

The default URL opens the public home page. Public routes use `?page=events`,
`?page=event&id=...`, `?page=competition&id=...`, and
`?page=signup&id=...`. The public home page includes **Admin login**, which opens
`?app=command`; the existing
`?portal=contestant` and `?display=leaderboard` routes remain available.
`?app=registration` opens the restricted Registration Desk for staff who may
maintain contestant profiles, configure contestant four-digit login PINs, and
submit eligible entries but may not access event configuration, Run Desk,
reports, results, payouts, or LED controls. At checkout, the cashier selects
**Paid in cash**, **Paid with credit card**, or **Open a tab**. Credit cards are
charged separately on the arena's portable Square Terminal before the cashier
records the payment; ArenaProject never receives or stores card data. Open tabs
remain visibly unpaid for settlement but are authorized to enter the draw.

### Permanent Wix Data storage

1. Enable Velo developer mode in Wix.
2. Create these Wix Data collections: `ArenaMeets`, `ArenaCompetitions`,
   `ArenaContestants`, `ArenaTeams`, `ArenaRegistrations`, `ArenaSpectators`,
   `ArenaSpectatorPredictions`, `ArenaSettings`, and `ArenaContestantCredentials`.
3. Add `appId` and `payload` text fields to the first seven collections. Online
   team and registration payloads may also contain optional `source`,
   `submissionId`, and `submittedAt` properties. Add
   `activeEventId` (text), `participantDatabaseVersion` (number), and `updatedAt`
   (date/time) to `ArenaSettings`, plus `value` (number, default `0`) for the
   separate staff and online revision records created by the backend.
4. Set every collection's permissions to **Admin only**. Public access is
   provided only by the backend's purpose-built `Permissions.Anyone` methods;
   visitors never query collections directly.
5. Copy `wix/backend/arena-data.web.js` into the Wix backend and copy
   `wix/page-code.js` into the page containing the app. The backend exposes
   `loadPublicArenaData`, `createContestantAccount`, `loadSignupOptions`,
   `submitOnlineSignup`, and `submitSpectatorPrediction`; keep their checked-in
   permissions unchanged.
6. Give the Wix HTML embed element the ID `arenaCommandEmbed` and set its URL
   to the hosted Arena Command app.
7. Add `contestantId`, `emailNormalized`, `pinSalt`, `pinHash`,
   `failedAttempts`, `lockedUntil`, and `updatedAt` fields to
   `ArenaContestantCredentials`.
8. Create a long random secret named `ArenaContestantPinPepper` in Wix Secrets
   Manager. Never expose this secret or the credentials collection to site visitors.
9. In **Wix Dashboard → Customer Management → Roles & Permissions**, create a
   dedicated member role for Arena Command administrators. Copy its role ID and
   save it in Wix Secrets Manager as `ArenaAdminRoleId`. Assign the role only to
   approved staff. The backend compares the exact role ID; the role name is not
   trusted and the secret is never returned to the browser.
   Create a second role for restricted registration staff and save its role ID as
   `ArenaRegistrationRoleId`. Members with this role can use only the
   Registration Desk APIs; Arena Admin members may also open that desk.
10. Enable Wix Members login on the page. `wix/page-code.js` uses
    `wix-members-frontend.authentication.promptLogin()` for the modal, while
    `wix/backend/arena-data.web.js` uses `wix-members-backend.currentMember`
    to enforce the role on every workspace load, save, and contestant PIN change.
    Do not replace the backend check with page visibility or iframe state.
11. Set `VITE_WIX_HOST_ORIGIN` to the exact public origin of the Wix site before
   building (for example, `https://example.wixsite.com`). This prevents embedded
   copies on other sites from receiving contestant credentials.
   For GitHub Pages deployment, create a repository Actions variable with that name.
   Add a unique index to `ArenaContestantCredentials.emailNormalized`.

When opened by a Wix administrator, the app shows **Saved to Wix** and
synchronizes events, contestants, registrations, teams, draws, and results.
Outside Wix it shows **Local preview** and uses browser storage.

`npm run dev` permits `?app=command` only in Vite development mode and displays
a warning banner. Production builds served outside the configured Wix embed show
an unavailable state instead of bypassing authorization. Wix Members APIs are
only partially functional in Wix editor preview; verify role behavior on a
published staging or production site.

Online entry is limited to existing contestant credentials. PINs are verified
for both option loading and submission and are never stored in browser storage.
Online teams and registrations start unpaid and do not enter generated draws
until staff confirms payment. Revision-aware staff saves preserve online
records submitted after the staff workspace was loaded.
