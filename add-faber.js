// Add Brock Faber to MIN — signed an 8yr/$7M extension (real 2025 signing)
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Scripts/NHL/Capologist/data/nhl-cap-data.json','utf8'));

// Check if already there
const exists = data.players.find(p => p.name === 'Brock Faber');
if (exists) {
  console.log('Faber already exists:', exists.id);
} else {
  data.players.push({ id: 'MIN_24', name: 'Brock Faber', pos: 'D', age: 23 });
  data.contracts.push({ playerId: 'MIN_24', team: 'MIN', type: 'RFA', startSeason: '2025-26', years: 8, aav: 7000000 });
  console.log('✓ Added Brock Faber (MIN_24, D, 23, 8yr/$7M RFA)');
}

fs.writeFileSync('C:/Scripts/NHL/Capologist/data/nhl-cap-data.json', JSON.stringify(data, null, 2), 'utf8');
console.log('Players:', data.players.length, '| Contracts:', data.contracts.length);
