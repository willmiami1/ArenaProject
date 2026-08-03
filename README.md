# Arena Command

A responsive team roping arena manager designed to run as an embedded web app
inside a Wix site.

## Features

- Parent arena events with independent roping competitions underneath
- Event and active-roping switching
- Competition setup for Draw Pot, Pick Only, Pick and Draw, and Round Robin
- Format-aware individual or team registration
- Automatic partner draws, round-robin schedules, redraw history, and draw locks
- Contestant roster with header/heeler positions
- Team entry and randomized draw order
- Run desk for times, penalties, no-times, and notes
- Live standings, round-robin points, and event overview
- Configurable fees, purse calculations, and payout splits
- Check-in, wait list, scratches, CSV/Excel exports, and printable PDF reports
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
