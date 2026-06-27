# IceCap — NHL Salary Cap Tracker

A static single-page app for tracking NHL team salary-cap situations: per-team cap
sheets, league standings, a trade simulator, and multi-season cap projections.

- **Frontend:** React (loaded as CDN globals) + JSX, precompiled with esbuild. No
  runtime Babel.
- **Data:** a single `data/nhl-cap-data.json` (32 teams, ~1,600 contracts) scraped from
  Spotrac and refreshed on a schedule.

## Develop / build

```bash
npm install        # install esbuild
npm run build      # -> dist/ (index.html, app.js, data/)
npm run serve      # serve dist/ at http://localhost:3000
```

`src/app.jsx` is the entire app; `index.html` is the shell that loads React from CDN and
`app.js`. The build transpiles/minifies `src/app.jsx` into `dist/app.js` and copies
`index.html` + `data/` alongside it.

## Data refresh

```bash
npm run refresh    # re-scrape Spotrac -> data/nhl-cap-data.json (atomic write)
```

Runs automatically via `.github/workflows/refresh-data.yml` (daily + manual dispatch).

## Deploy

Hosted on Cloudflare Pages (connected to this GitHub repo):

- **Build command:** `npm ci && npm run build`
- **Output directory:** `dist`

Every push to `main` auto-deploys. The scheduled data refresh commits an updated JSON,
which triggers a redeploy.
