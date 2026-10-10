// The site covers the current NHL season plus the following seasons — enough
// to show an 8-year contract signed this year. Each July 1 (the start of the
// league year) the window moves forward: the finished season is dropped and a
// new final season is added with a projected cap.
//
// Usage:
//   node scripts/season-window.mjs                      # roll data/nhl-cap-data.json to today
//   node scripts/season-window.mjs --as-of 2027-07-01   # roll as if it were that date
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const WINDOW_SEASONS = 8;
const PROJECTED_CAP_STEP = 3_500_000;
// The CBA sets the floor and ceiling at the midpoint -15% / +15%.
const FLOOR_TO_CEILING = 0.85 / 1.15;

export function seasonAt(season, offset) {
  const start = Number(season.slice(0, 4)) + offset;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function currentSeason(date = new Date()) {
  const year = date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

export function contractSeasons(contract) {
  if (!contract.startSeason || !contract.years) return [];
  return Array.from({ length: contract.years }, (_, i) => seasonAt(contract.startSeason, i));
}

function projectedCap(previous) {
  const ceiling = previous.ceiling + PROJECTED_CAP_STEP;
  return { ceiling, floor: Math.round((ceiling * FLOOR_TO_CEILING) / 100_000) * 100_000, projected: true };
}

// Moves `data` to the window starting at `first`. Returns true if anything changed.
export function rollSeasonWindow(data, first) {
  const before = JSON.stringify(data);
  const seasons = Array.from({ length: WINDOW_SEASONS }, (_, i) => seasonAt(first, i));
  const inWindow = new Set(seasons);
  const meta = data.meta;

  const caps = {};
  seasons.forEach((season, i) => {
    caps[season] = meta.caps?.[season] || projectedCap(caps[seasons[i - 1]] || meta.caps[seasonAt(season, -1)]);
  });
  meta.caps = caps;
  meta.seasons = seasons;
  meta.defaultSeason = first;

  for (const key of ["capSheets", "standings"]) {
    data[key] = Object.fromEntries(Object.entries(data[key] || {}).filter(([season]) => inWindow.has(season)));
  }

  data.contracts = data.contracts.filter((contract) => contractSeasons(contract).some((season) => inWindow.has(season)));
  data.contracts.forEach((contract) => {
    if (!contract.capHits) return;
    contract.capHits = Object.fromEntries(Object.entries(contract.capHits).filter(([season]) => inWindow.has(season)));
  });

  const referenced = new Set(data.contracts.map((contract) => contract.playerId));
  Object.values(data.capSheets).forEach((teams) =>
    Object.values(teams).forEach((sheet) => sheet.items.forEach((item) => referenced.add(item.playerId)))
  );
  data.players = data.players.filter((player) => referenced.has(player.id));

  return JSON.stringify(data) !== before;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const asOfIdx = process.argv.indexOf("--as-of");
  const asOf = asOfIdx > -1 ? new Date(process.argv[asOfIdx + 1]) : new Date();
  const dataPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "nhl-cap-data.json");
  const raw = fs.readFileSync(dataPath, "utf8");
  const data = JSON.parse(raw);
  const first = currentSeason(asOf);
  if (rollSeasonWindow(data, first)) {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + (raw.endsWith("\n") ? "\n" : ""), "utf8");
    console.log(`Season window is now ${data.meta.seasons[0]} – ${data.meta.seasons.at(-1)}.`);
  } else {
    console.log(`Season window already starts at ${first}.`);
  }
}
