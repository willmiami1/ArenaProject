# Arena Command

A responsive team roping arena manager designed to run as an embedded web app
inside a Wix site.

## Features

- Event setup and active-event switching
- Contestant roster with header/heeler positions
- Team entry and randomized draw order
- Run desk for times, penalties, no-times, and notes
- Live standings and event overview
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
