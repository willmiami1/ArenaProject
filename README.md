# Arena Command

A responsive team roping arena manager designed to run as an embedded web app
inside a Wix site.

## Features

- Parent arena events with independent roping competitions underneath
- Event and active-roping switching
- Competition setup for Draw Pot, Pick Only, Pick and Draw, and Round Robin
- Format-aware individual or team registration
- One Round 1 run per partner pairing by default, with optional repeat partner runs
- Automatic partner draws, round-robin schedules, redraw history, and draw locks
- Contestant roster with header/heeler positions
- Team entry and randomized draw order
- Run desk for times, penalties, no-times, and notes
- Configurable Short Go limits that advance only the fastest qualified teams
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

### Permanent Wix Data storage

1. Enable Velo developer mode in Wix.
2. Create these Wix Data collections: `ArenaMeets`, `ArenaCompetitions`,
   `ArenaContestants`, `ArenaTeams`, `ArenaRegistrations`, and `ArenaSettings`.
3. Add `appId` and `payload` text fields to the first five collections. Add
   `activeEventId` (text), `participantDatabaseVersion` (number), and `updatedAt`
   (date/time) to `ArenaSettings`.
4. Set every collection's permissions to **Admin only**.
5. Copy `wix/backend/arena-data.web.js` into the Wix backend and copy
   `wix/page-code.js` into the page containing the app.
6. Give the Wix HTML embed element the ID `arenaCommandEmbed` and set its URL
   to the hosted Arena Command app.

When opened by a Wix administrator, the app shows **Saved to Wix** and
synchronizes events, contestants, registrations, teams, draws, and results.
Outside Wix it shows **Local preview** and uses browser storage.
