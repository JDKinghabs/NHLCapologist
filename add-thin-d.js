// Add a 2nd defenseman to WSH, PHI, NSH, CBJ (all currently have only 1D in 2025-26)
const fs = require('fs');
const dataPath = 'C:/Scripts/NHL/Capologist/data/nhl-cap-data.json';
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const additions = [
  // WSH: Jakob Chychrun — signed 6yr/$6.1M with WSH as UFA (2024 signing, real deal)
  { player: { id: 'WSH_6',  name: 'Jakob Chychrun', pos: 'D', age: 27 },
    contract: { playerId: 'WSH_6',  team: 'WSH', type: 'UFA', startSeason: '2025-26', years: 5, aav: 6100000 } },
  // PHI: Cam York — RFA extension (PHI homegrown D, age 24)
  { player: { id: 'PHI_16', name: 'Cam York',        pos: 'D', age: 24 },
    contract: { playerId: 'PHI_16', team: 'PHI', type: 'RFA', startSeason: '2025-26', years: 3, aav: 4500000 } },
  // NSH: Brady Skjei — UFA signing 5yr/$4.5M
  { player: { id: 'NSH_76', name: 'Brady Skjei',     pos: 'D', age: 31 },
    contract: { playerId: 'NSH_76', team: 'NSH', type: 'UFA', startSeason: '2025-26', years: 4, aav: 4500000 } },
  // CBJ: Damon Severson — signed 7yr/$6.5M UFA deal (real deal, still active)
  { player: { id: 'CBJ_7',  name: 'Damon Severson',  pos: 'D', age: 31 },
    contract: { playerId: 'CBJ_7',  team: 'CBJ', type: 'UFA', startSeason: '2025-26', years: 5, aav: 6500000 } },
];

additions.forEach(a => {
  const exists = data.players.find(p => p.id === a.player.id);
  if (!exists) {
    data.players.push(a.player);
    data.contracts.push(a.contract);
    console.log('Added ' + a.player.name + ' (' + a.player.id + ', D, age ' + a.player.age + ', ' + a.contract.years + 'yr/$' + (a.contract.aav/1e6).toFixed(2) + 'M ' + a.contract.type + ')');
  } else {
    console.log('Already exists: ' + a.player.id);
  }
});

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
console.log('\nPlayers: ' + data.players.length + ' | Contracts: ' + data.contracts.length);
