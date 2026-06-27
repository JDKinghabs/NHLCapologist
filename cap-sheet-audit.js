const fs = require('fs');

const dataPath = 'C:/Scripts/NHL/Capologist/data/nhl-cap-data.json';
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const seasons = data.meta?.seasons || [];
const season = process.argv[2] || data.meta?.defaultSeason || seasons[0];
const capSheets = data.capSheets?.[season] || {};

function buildSeasonList(startSeason, years, allSeasons) {
  if (!startSeason || !years) return [];
  const startIdx = allSeasons.indexOf(startSeason);
  if (startIdx === -1) return [];
  return allSeasons.slice(startIdx, startIdx + years);
}

function isActiveSeason(contract, targetSeason, allSeasons) {
  return buildSeasonList(contract.startSeason, contract.years, allSeasons).includes(targetSeason);
}

const activeContracts = (data.contracts || []).filter((contract) => isActiveSeason(contract, season, seasons));
const contractsByTeam = activeContracts.reduce((map, contract) => {
  if (!map[contract.team]) map[contract.team] = [];
  map[contract.team].push(contract);
  return map;
}, {});

const rows = (data.teams || []).map((team) => {
  const sheet = capSheets[team.abbr];
  const items = Array.isArray(sheet?.items) ? sheet.items : [];
  const adjustments = Array.isArray(sheet?.adjustments) ? sheet.adjustments : [];
  const contractList = contractsByTeam[team.abbr] || [];
  const missingPlayerRefs = items
    .filter((item) => item.kind === 'player')
    .filter((item) => !contractList.some((contract) => contract.playerId === item.playerId));
  const byCategory = items.reduce((map, item) => {
    const key = item.category || 'uncategorized';
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});

  return {
    abbr: team.abbr,
    status: sheet?.status || 'missing',
    items: items.length,
    active: byCategory.active || 0,
    ir: byCategory.ir || 0,
    ltir: byCategory.ltir || 0,
    minors: byCategory.minors || 0,
    reserve: byCategory.reserve || 0,
    nonRoster: byCategory.nonRoster || 0,
    adjustments: adjustments.length,
    activeContracts: contractList.length,
    missingPlayerRefs: missingPlayerRefs.length
  };
});

const statusCounts = rows.reduce((map, row) => {
  map[row.status] = (map[row.status] || 0) + 1;
  return map;
}, {});

console.log(`=== CAP SHEET AUDIT (${season}) ===`);
console.log(`Teams: ${rows.length}`);
console.log(`Statuses: ${Object.entries(statusCounts).map(([status, count]) => `${status}=${count}`).join(', ')}`);
console.log(`Missing cap sheets: ${rows.filter((row) => row.status === 'missing').length}`);
console.log(`Teams under 18 tracked player items: ${rows.filter((row) => row.items < 18).length}`);
console.log(`Teams with adjustments entered: ${rows.filter((row) => row.adjustments > 0).length}`);
console.log(`Teams with unresolved player refs: ${rows.filter((row) => row.missingPlayerRefs > 0).length}`);
console.log('');
console.log('Team | Status     | Items | Active | IR | LTIR | Min | Res | N/R | Adj | Contracts');
console.log('-----|------------|-------|--------|----|------|-----|-----|-----|-----|----------');

rows
  .sort((a, b) => a.items - b.items || a.abbr.localeCompare(b.abbr))
  .forEach((row) => {
    console.log(
      `${row.abbr.padEnd(4)} | ${row.status.padEnd(10)} | ${String(row.items).padEnd(5)} | ${String(row.active).padEnd(6)} | ${String(row.ir).padEnd(2)} | ${String(row.ltir).padEnd(4)} | ${String(row.minors).padEnd(3)} | ${String(row.reserve).padEnd(3)} | ${String(row.nonRoster).padEnd(3)} | ${String(row.adjustments).padEnd(3)} | ${row.activeContracts}`
    );
  });

const thinTeams = rows.filter((row) => row.items < 18).map((row) => row.abbr);
if (thinTeams.length) {
  console.log('');
  console.log(`Needs cap-sheet expansion (<18 tracked players): ${thinTeams.join(', ')}`);
}
