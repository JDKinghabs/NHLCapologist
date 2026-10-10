// Checks data/nhl-cap-data.json before it is committed or deployed. Payrolls
// are computed with the site's own code (src/cap-math.js), so a check passes
// only if the numbers the site shows match Spotrac's totals.
//
// Usage:
//   node scripts/validate-data.mjs [path/to/data.json]
// Exits 1 when there are errors; warnings are printed but don't fail.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildSeasonList, buildTeamData, seasonAt } from "../src/cap-math.js";

const DATA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "nhl-cap-data.json");
const POSITIONS = new Set(["C", "LW", "RW", "F", "D", "G"]);
const EXPIRY_STATUSES = new Set(["UFA", "RFA"]);
const SEASON_PATTERN = /^\d{4}-\d{2}$/;
const MAX_TERM = 8;
const MAX_SALARY_SHARE = 0.2; // a player's cap hit can't exceed 20% of the ceiling
const TOLERANCE = 1000; // rounding in Spotrac's totals
const OVER_TOTAL_TOLERANCE = 2_500_000; // same limit as scripts/refresh-data.js
const CURRENT_PAYROLL_RANGE = [0.6, 1.3]; // share of the ceiling

const fmt = (amount) => `$${Math.round(amount).toLocaleString("en-US")}`;
const money = (text) => Number(text.replace(/[$,]/g, ""));

// Spotrac's figures as recorded in a cap sheet's notes by the refresh script.
function spotracTotals(notes = []) {
  const text = notes.join("\n");
  const allocations = text.match(/Spotrac total allocations=(-?\$-?[\d,]+)/);
  const totalCap = text.match(/Spotrac total cap=(-?\$-?[\d,]+)/);
  const skipped = [...text.matchAll(/Skipped .*?: Spotrac cap hit (\$[\d,]+)/g)].reduce((sum, m) => sum + money(m[1]), 0);
  return {
    allocations: allocations ? money(allocations[1]) : null,
    totalCap: totalCap ? money(totalCap[1]) : null,
    skipped,
    overageNoted: /more than Spotrac's projected total cap/.test(text),
  };
}

export function validateData(data, { expectedTeams = 32 } = {}) {
  const errors = [];
  const warnings = [];
  const error = (message) => errors.push(message);

  // Seasons and caps
  const seasons = data.meta?.seasons || [];
  if (!seasons.length) error("meta.seasons is empty");
  seasons.forEach((season, i) => {
    if (!SEASON_PATTERN.test(season)) error(`meta.seasons has a malformed season "${season}"`);
    else if (i > 0 && season !== seasonAt(seasons[0], i)) error(`meta.seasons is not consecutive at ${season}`);
    const cap = data.meta.caps?.[season];
    if (!cap || !(cap.ceiling > 0) || !(cap.floor > 0) || cap.floor >= cap.ceiling) {
      error(`${season}: missing or invalid cap ceiling/floor`);
    }
  });
  if (data.meta?.defaultSeason !== seasons[0]) error(`meta.defaultSeason ${data.meta?.defaultSeason} is not the first season ${seasons[0]}`);
  const current = seasons[0];

  // Teams
  const teams = data.teams || [];
  const teamAbbrs = new Set(teams.map((team) => team.abbr));
  if (teamAbbrs.size !== teams.length) error("duplicate team abbreviations");
  if (teams.length !== expectedTeams) error(`expected ${expectedTeams} teams, found ${teams.length}`);
  teams.forEach((team) => {
    if (!team.name) error(`${team.abbr}: missing team name`);
    if (!(data.divisions || []).includes(team.division)) error(`${team.abbr}: unknown division ${team.division}`);
  });

  // Players
  const players = new Map();
  (data.players || []).forEach((player) => {
    if (players.has(player.id)) error(`duplicate player id ${player.id}`);
    players.set(player.id, player);
    if (!player.name) error(`${player.id}: missing name`);
    if (!POSITIONS.has(player.pos)) error(`${player.id} ${player.name}: invalid position ${JSON.stringify(player.pos)}`);
    if (player.age != null && !(player.age >= 16 && player.age <= 50)) error(`${player.id} ${player.name}: implausible age ${player.age}`);
  });

  // Contracts
  const seasonsByPlayer = new Map();
  (data.contracts || []).forEach((contract) => {
    const who = `${contract.team} ${contract.playerId} contract from ${contract.startSeason}`;
    if (!players.has(contract.playerId)) error(`${who}: unknown player`);
    if (!teamAbbrs.has(contract.team)) error(`${who}: unknown team`);
    if (!SEASON_PATTERN.test(contract.startSeason || "")) return error(`${who}: malformed start season`);
    if (!(Number.isInteger(contract.years) && contract.years >= 1 && contract.years <= MAX_TERM)) return error(`${who}: invalid term ${contract.years}`);
    if (!(contract.aav > 0)) error(`${who}: invalid AAV ${contract.aav}`);
    if (contract.expiryStatus != null && !EXPIRY_STATUSES.has(contract.expiryStatus)) error(`${who}: invalid expiry status ${contract.expiryStatus}`);
    const term = buildSeasonList(contract.startSeason, contract.years);
    Object.keys(contract.capHits || {}).forEach((season) => {
      if (!term.includes(season)) error(`${who}: cap hit for ${season} is outside its term`);
    });
    const taken = seasonsByPlayer.get(contract.playerId) || new Set();
    term.forEach((season) => {
      if (taken.has(season)) error(`${contract.playerId}: overlapping contracts in ${season}`);
      taken.add(season);
    });
    seasonsByPlayer.set(contract.playerId, taken);
  });
  const contractKeys = new Set(
    (data.contracts || []).flatMap((c) => buildSeasonList(c.startSeason, c.years).map((season) => `${season}|${c.team}|${c.playerId}`))
  );

  // Cap sheets, reconciled with Spotrac through the site's own payroll math
  seasons.forEach((season) => {
    const ceiling = data.meta.caps?.[season]?.ceiling || 0;
    const payrolls = Object.fromEntries(buildTeamData(data, season, ceiling).map((team) => [team.abbr, team.payroll]));
    teams.forEach(({ abbr }) => {
      const where = `${season} ${abbr}`;
      const sheet = data.capSheets?.[season]?.[abbr];
      // A failed future page keeps last-known-good data, so only the current season must be complete.
      const problem = season === current ? error : (message) => warnings.push(message);
      if (!sheet) return problem(`${where}: no cap sheet`);
      if (sheet.status !== "complete") problem(`${where}: cap sheet status is ${sheet.status}`);

      const seen = new Set();
      (sheet.items || []).filter((item) => item.kind === "player").forEach((item) => {
        const name = players.get(item.playerId)?.name || item.playerId;
        if (seen.has(item.playerId)) error(`${where}: ${name} is listed twice`);
        seen.add(item.playerId);
        if (!players.has(item.playerId)) error(`${where}: unknown player ${item.playerId}`);
        if (!contractKeys.has(`${season}|${abbr}|${item.playerId}`)) error(`${where}: ${name} has no contract covering this season, so the site drops him`);
        if (!(item.capHit >= 0)) error(`${where}: ${name} has an invalid cap hit ${item.capHit}`);
        if (item.capHit > MAX_SALARY_SHARE * ceiling) error(`${where}: ${name}'s cap hit ${fmt(item.capHit)} exceeds the max player salary`);
      });

      const payroll = payrolls[abbr];
      const spotrac = spotracTotals(sheet.notes);
      if (season === current) {
        const [low, high] = CURRENT_PAYROLL_RANGE;
        if (payroll < low * ceiling || payroll > high * ceiling) error(`${where}: payroll ${fmt(payroll)} is outside ${low * 100}-${high * 100}% of the ceiling`);
        if (spotrac.allocations == null) return warnings.push(`${where}: no Spotrac total to reconcile with`);
        // The sheet adds Spotrac's cap-maximum cut as a charge and leaves out rows it refused.
        const capMaxCut = (sheet.adjustments || [])
          .filter((adj) => adj.label === "Salary cap maximum adjustment")
          .reduce((sum, adj) => sum + adj.amount, 0);
        const diff = payroll - capMaxCut + spotrac.skipped - spotrac.allocations;
        if (Math.abs(diff) > TOLERANCE) error(`${where}: site payroll differs from Spotrac's total allocations ${fmt(spotrac.allocations)} by ${fmt(diff)}`);
      } else {
        if (spotrac.totalCap == null) return warnings.push(`${where}: no Spotrac total to reconcile with`);
        // Unitemized money is added as a "buried" charge, so the site is never below Spotrac;
        // a small, noted overage is accepted, as in the refresh script.
        const diff = payroll - spotrac.totalCap;
        const noted = spotrac.overageNoted && diff <= OVER_TOTAL_TOLERANCE;
        if (diff < -TOLERANCE || (diff > TOLERANCE && !noted)) error(`${where}: site payroll differs from Spotrac's total cap ${fmt(spotrac.totalCap)} by ${fmt(diff)}`);
      }
    });
  });

  // Standings
  Object.entries(data.standings || {}).forEach(([season, table]) => {
    if (season !== current) error(`standings kept for ${season}, not the current season`);
    Object.entries(table).forEach(([abbr, row]) => {
      if (!teamAbbrs.has(abbr)) error(`${season} standings: unknown team ${abbr}`);
      if (row.gp !== row.w + row.l + row.ot) error(`${season} standings: ${abbr} games played ${row.gp} != W+L+OT`);
    });
  });

  return { errors, warnings };
}

function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : DATA_PATH;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const { errors, warnings } = validateData(data);
  warnings.forEach((message) => console.warn(`warning: ${message}`));
  errors.forEach((message) => console.error(`error: ${message}`));
  const counts = `${data.teams?.length} teams, ${data.players?.length} players, ${data.contracts?.length} contracts, ${data.meta?.seasons?.length} seasons`;
  if (errors.length) {
    console.error(`\n${path.basename(file)} failed validation: ${errors.length} error(s), ${warnings.length} warning(s) (${counts}).`);
    process.exit(1);
  }
  console.log(`${path.basename(file)} is valid: ${counts}; ${warnings.length} warning(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
