const fs = require('fs');

const dataPath = 'C:/Scripts/NHL/Capologist/data/nhl-cap-data.json';
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

function buildSeasonList(startSeason, years, seasons) {
  if (!startSeason || !years) return [];
  const startIdx = seasons.indexOf(startSeason);
  if (startIdx === -1) return [];
  return seasons.slice(startIdx, startIdx + years);
}

function isActiveSeason(contract, season, seasons) {
  return buildSeasonList(contract.startSeason, contract.years, seasons).includes(season);
}

const seasons = data.meta?.seasons || [];
const teams = data.teams || [];

data.meta = data.meta || {};
data.meta.schemaVersion = 2;
data.meta.capSheetSchema = {
  itemKinds: ['player'],
  playerCategories: ['active', 'ir', 'ltir', 'nonRoster', 'minors', 'reserve'],
  adjustmentKinds: ['retainedSalary', 'buyout', 'buried', 'bonusOverage', 'termination', 'recapture', 'other'],
  statuses: ['scaffolded', 'reviewed', 'complete']
};

const existingCapSheets = data.capSheets || {};
const nextCapSheets = {};

seasons.forEach((season) => {
  const currentSeasonSheets = existingCapSheets[season] || {};
  const nextSeasonSheets = {};

  teams.forEach((team) => {
    const existingSheet = currentSeasonSheets[team.abbr] || {};
    const existingItems = Array.isArray(existingSheet.items) ? existingSheet.items : [];
    const existingAdjustments = Array.isArray(existingSheet.adjustments) ? existingSheet.adjustments : [];
    const activeContracts = (data.contracts || [])
      .filter((contract) => contract.team === team.abbr && isActiveSeason(contract, season, seasons))
      .sort((a, b) => (b.aav || 0) - (a.aav || 0) || a.playerId.localeCompare(b.playerId));

    const scaffoldItems = activeContracts.map((contract) => ({
      kind: 'player',
      playerId: contract.playerId,
      category: 'active'
    }));

    nextSeasonSheets[team.abbr] = {
      status: existingSheet.status || 'scaffolded',
      items: existingItems.length > 0 ? existingItems : scaffoldItems,
      adjustments: existingAdjustments,
      notes: Array.isArray(existingSheet.notes) ? existingSheet.notes : []
    };
  });

  nextCapSheets[season] = nextSeasonSheets;
});

data.capSheets = nextCapSheets;

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');

console.log('Cap sheet scaffolding complete.');
console.log(`Schema version: ${data.meta.schemaVersion}`);
console.log(`Seasons scaffolded: ${Object.keys(nextCapSheets).length}`);
console.log(`Teams per season: ${teams.length}`);
