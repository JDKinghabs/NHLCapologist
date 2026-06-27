# IceCap — NHL Salary Cap Tracker

A static single-page app for tracking NHL team salary-cap situations: per-team cap
sheets, league standings, a trade simulator, and multi-season cap projections.

- **Frontend:** React (loaded as CDN globals) + JSX, precompiled with esbuild. No
  runtime Babel.
- **Data:** a single `data/nhl-cap-data.json` (32 teams, ~1,600 contracts) scraped from
  Spotrac and refreshed on a schedule.
