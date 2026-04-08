# RaceBud.ai Host Handoff

This project is a Node.js web application, not a static HTML site.

## What The Host Needs To Do

1. Ensure Node.js 22 LTS and npm are available
2. Upload or receive the project files
3. Run:

```bash
npm install
npm start
```

4. Keep the process alive with `pm2` or `systemd`
5. Put Nginx or equivalent reverse proxy in front of the app
6. Point the desired domain/subdomain to the app
7. Set `BASE_PATH=/demo` because this app should live under `/demo` while the root landing page stays up

## Important

The app must have write access to:

- `server/uploads/`
- `generated/sessions/`
- `generated/maps/`

## App Behavior

The backend accepts CSV uploads and parses telemetry server-side, so this cannot run on FTP-only static hosting.

## Default Port

- `3000` unless overridden with `PORT`

## App Path

- `/demo`

## First Test

After startup, open the app in the browser and upload the sample CSV files from:

- `example data/CSV/`

Successful startup should allow:

- multi-file upload
- lap detection
- fastest lap highlighting
- track map rendering
- manual start/finish correction
