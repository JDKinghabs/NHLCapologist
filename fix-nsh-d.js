// Fix: NSH_76 Brady Skjei was wrong — he's still on CAR (3yr deal through 2026-27)
// Remove NSH_76 and add Alexandre Carrier (NSH_48) instead — real NSH defenseman
const fs = require('fs');
const dataPath = 'C:/Scripts/NHL/Capologist/data/nhl-cap-data.json';
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Remove NSH_76 player and contract
const pIdx = data.players.findIndex(p => p.id === 'NSH_76');
if (pIdx !== -1) {
  console.log('Removed player:', data.players[pIdx].name);
  data.players.splice(pIdx, 1);
}
const cIdx = data.contracts.findIndex(c => c.playerId === 'NSH_76');
if (cIdx !== -1) {
  console.log('Removed NSH_76 contract');
  data.contracts.splice(cIdx, 1);
}

// Add Alexandre Carrier — NSH #48, age 28, signed 4yr extension ~$3M
const exists = data.players.find(p => p.id === 'NSH_48');
if (!exists) {
  data.players.push({ id: 'NSH_48', name: 'Alexandre Carrier', pos: 'D', age: 28 });
  data.contracts.push({ playerId: 'NSH_48', team: 'NSH', type: 'UFA', startSeason: '2025-26', years: 4, aav: 3000000 });
  console.log('Added Alexandre Carrier (NSH_48, D, age 28, 4yr/$3M UFA)');
}

// Verify no more Skjei duplicates
const skjeis = data.players.filter(p => p.name === 'Brady Skjei');
console.log('Brady Skjei entries:', skjeis.map(p => p.id).join(', '));

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
console.log('Players: ' + data.players.length + ' | Contracts: ' + data.contracts.length);
