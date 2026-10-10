# IceCap — NHL Salary Cap Tracker

A static site that tracks every NHL team's salary cap for the current season and the seven after it.

- **Dashboard**: every team's payroll, cap space and roster counts. Click a team for its cap sheet: each player's cap hit by season, clauses, bonuses, IR/LTIR/minors status, and UFA/RFA status when the contract ends.
- **Standings**: the current season's standings next to each team's payroll and cap space.
- **Trade Tool**: checks a trade against the cap, the 50-contract limit and retained-salary rules (up to 50%, at most 3 retained contracts per team).
- **Projections**: each team's committed money against each season's ceiling, with pending free agents per season.

Links are shareable: the URL holds the season, view and open team, e.g. `#/2026-27/dashboard/TOR`.

It runs on Cloudflare Pages (project `nhlcapologist`, <https://nhlcapologist.pages.dev>).

## Data sources

| Data | Source | Refreshed |
|---|---|---|
| Cap hits, contracts, clauses, bonuses, ages, UFA/RFA status, buried/retained/buyout charges | [Spotrac](https://www.spotrac.com/nhl/cap/) team cap pages | Daily |
| Standings, official team names | NHL stats API (`api-web.nhle.com/v1/standings/now`) | Daily |
| Cap ceilings | Spotrac where published; later seasons are projected at +$3.5M a year (floor = ceiling × 0.85 / 1.15) and labelled "Projected" | Daily |

Only real values are shown. When Spotrac doesn't give a field (an age, a status), the site leaves it blank rather than guessing.

## How the data stays fresh

`.github/workflows/refresh-data.yml` runs daily at 09:00 UTC, and can be run by hand from the Actions tab.

1. **`scripts/refresh-data.js`** reads two Spotrac pages per team, 64 requests at 1.5 s apart with retries:
   - `/nhl/<team>/cap/_/year/<YYYY>` for the current season: every roster group plus Spotrac's cap totals.
   - `/nhl/<team>/yearly/` for future seasons, ages and status at expiry.
2. Each page is checked against Spotrac's own totals before it's used. A page that doesn't add up (an alternate layout, a bad row) is refused, and that team keeps its last good data.
3. Players and contracts are rebuilt from the cap sheets: a player's consecutive seasons with one team at one cap hit make one contract.
4. On July 1 the season window rolls forward: the finished season drops off and a new final season is added with a projected ceiling.
5. **`scripts/refresh-standings.mjs`** updates the standings once the NHL has current-season games.
6. **`scripts/validate-data.mjs`** checks the result. It recomputes every team's payroll with the site's own code and compares it with Spotrac's totals; it also checks that every sheet player has a contract, and it checks positions, ages, duplicate players and overlapping contracts. **If validation fails, nothing is committed.**
7. If the data changed, it's committed to `main`, and Cloudflare Pages redeploys. Days with no changes make no commit.

**Alerts.** If some teams or the NHL API fail, whatever succeeded is still committed and the run is then marked failed, so GitHub emails you. The run's log lists what failed (`!! TOR multi-year FAILED: …`).

**Manual run inputs** (Actions → Refresh cap data → Run workflow):

| Input | Use |
|---|---|
| `dry_run` | Scrape and log, but don't write or commit |
| `debug_team` | Print one team's Spotrac table markup to the log, e.g. `NYI` |
| `debug_player` | Also print table rows naming these players (`Name One\|Name Two`) |
| `debug_url` | Only fetch and summarize these Spotrac URLs (comma-separated); no refresh |

Spotrac rate-limits heavy use (HTTP 403 after several hundred requests), so avoid running the refresh many times in a row.

## Running locally

Requires Node 22 or newer.

```sh
npm ci                 # install dependencies
npm run build          # bundle the app into dist/
npm run serve          # serve dist/ at http://localhost:3000
```

Checks (the same ones CI runs on every pull request):

```sh
npm test               # unit tests (node --test)
npm run validate       # validate data/nhl-cap-data.json
npx playwright install chromium   # once
npm run smoke          # headless browser test of the built site
```

To refresh the data yourself (needs network access to Spotrac and the NHL API):

```sh
npm run refresh                          # all teams
node scripts/refresh-data.js TOR         # one team
REFRESH_DRY_RUN=true npm run refresh     # log only
node scripts/refresh-standings.mjs
```

## Project layout

| Path | What it is |
|---|---|
| `index.html` | Page shell and all CSS |
| `src/app.jsx` | The React app (views, cap sheet, trade tool, projections) |
| `src/cap-math.js` | Contract and payroll math, shared with the validator |
| `src/routes.js` | Shareable-link parsing |
| `data/nhl-cap-data.json` | All site data, written by the refresh scripts |
| `scripts/build.mjs` | esbuild bundle (React included, so no third-party scripts) + copy to `dist/` |
| `scripts/refresh-data.js` | Spotrac scraper |
| `scripts/refresh-standings.mjs` | NHL standings and team names |
| `scripts/season-window.mjs` | Season window, July 1 rollover, projected ceilings |
| `scripts/validate-data.mjs` | Data checks (run in CI and before every data commit) |
| `scripts/smoke-test.mjs` | Headless Chromium test of every view at desktop and phone widths |
| `tests/` | Unit tests; `tests/fixtures/` holds captured Spotrac markup |
| `.github/workflows/ci.yml` | Pull request checks |
| `.github/workflows/refresh-data.yml` | Daily data refresh |

### Data file

`data/nhl-cap-data.json` holds:

- `meta`: seasons, cap ceilings and floors, and update dates;
- `teams` and `divisions`;
- `players`: Spotrac IDs (`SR_<id>`), names, positions, ages;
- `contracts`: player, team, start season, term, AAV, per-season cap hits, clause, expiry status;
- `capSheets[season][team]`: player items and charges, plus notes recording Spotrac's totals;
- `standings[currentSeason][team]`: games played, wins, losses and OT losses.

## Deploying

Cloudflare Pages builds `main` on every push and builds a preview for every pull request.

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Production branch | `main` |
| Environment variable | `NODE_VERSION` = `22` (if the default is older) |

IceCap is an independent fan site, not affiliated with the NHL, its teams or Spotrac.
