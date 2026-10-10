// Refresh the standings and official team names in data/nhl-cap-data.json
// from the NHL's public stats API. Only the site's current season is stored:
// until that season starts, the API still reports last season, which is
// skipped.
//
// Usage:
//   node scripts/refresh-standings.mjs
//   REFRESH_DRY_RUN=true node scripts/refresh-standings.mjs   # log only
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DATA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "nhl-cap-data.json");
const STANDINGS_URL = "https://api-web.nhle.com/v1/standings/now";
const DRY_RUN = process.env.REFRESH_DRY_RUN === "true";

// "2026-27" -> 20262027, the API's season id.
export function seasonId(season) {
  const start = Number(season.slice(0, 4));
  return Number(`${start}${start + 1}`);
}

export function parseStandings(json, season) {
  const rows = json?.standings;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("NHL standings response has no standings rows");
  const current = rows.filter((row) => row.seasonId === seasonId(season));
  if (!current.length) return null;

  const standings = {};
  const names = {};
  let asOf = null;
  current.forEach((row) => {
    const abbr = row.teamAbbrev?.default;
    const record = [row.gamesPlayed, row.wins, row.losses, row.otLosses];
    if (!abbr || !record.every(Number.isFinite)) {
      throw new Error(`Unexpected NHL standings row: ${JSON.stringify(row).slice(0, 200)}`);
    }
    standings[abbr] = { gp: row.gamesPlayed, w: row.wins, l: row.losses, ot: row.otLosses };
    if (row.teamName?.default) names[abbr] = row.teamName.default;
    if (row.date && (!asOf || row.date > asOf)) asOf = row.date;
  });
  return { standings, names, asOf };
}

async function main() {
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  const data = JSON.parse(raw);
  const season = data.meta.seasons[0];

  const res = await fetch(STANDINGS_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`NHL standings request failed: HTTP ${res.status}`);
  const parsed = parseStandings(await res.json(), season);
  if (!parsed) {
    console.log(`The NHL has no ${season} standings yet — leaving standings unchanged.`);
    return;
  }

  const known = new Set(data.teams.map((team) => team.abbr));
  const unknown = Object.keys(parsed.standings).filter((abbr) => !known.has(abbr));
  if (unknown.length) console.warn(`Ignoring standings for teams not in the data: ${unknown.join(", ")}`);
  const missing = [...known].filter((abbr) => !parsed.standings[abbr]);
  if (missing.length) console.warn(`No standings returned for: ${missing.join(", ")}`);

  data.standings = data.standings || {};
  data.standings[season] = Object.fromEntries(Object.entries(parsed.standings).filter(([abbr]) => known.has(abbr)));
  data.teams.forEach((team) => {
    if (parsed.names[team.abbr]) team.name = parsed.names[team.abbr];
  });
  data.meta.standingsAsOf = parsed.asOf;

  const out = JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : "");
  const summary = `${season} standings as of ${parsed.asOf}: ${Object.keys(data.standings[season]).length} teams`;
  if (out === raw) {
    console.log(`${summary} — unchanged.`);
  } else if (DRY_RUN) {
    console.log(`${summary} — dry run, not writing.`);
  } else {
    fs.writeFileSync(`${DATA_PATH}.tmp`, out, "utf8");
    fs.renameSync(`${DATA_PATH}.tmp`, DATA_PATH);
    console.log(`${summary} — written.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
