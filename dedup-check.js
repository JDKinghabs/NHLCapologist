const data = JSON.parse(require('fs').readFileSync('C:/Scripts/NHL/Capologist/data/nhl-cap-data.json','utf8'));

// Find duplicate players by name
const names = {};
data.players.forEach(p => {
  if (!names[p.name]) names[p.name] = [];
  names[p.name].push({ id: p.id, age: p.age });
});
const dups = Object.entries(names).filter(([n, entries]) => entries.length > 1);
console.log('Duplicate player names:', JSON.stringify(dups, null, 2));

// Find duplicate contracts
const seen = {};
const dupC = [];
data.contracts.forEach(c => {
  const k = `${c.playerId}|${c.team}|${c.startSeason}`;
  if (seen[k]) dupC.push(k);
  seen[k] = true;
});
console.log('\nDuplicate contract keys:', dupC.length, dupC);

// Show all players for problem teams
['CAR','MIN','ANA'].forEach(team => {
  const players = data.players.filter(p => p.id.startsWith(team + '_'));
  const contracts25 = data.contracts.filter(c => c.team === team && c.startSeason === '2025-26');
  console.log(`\n${team} players:`, players.map(p => `${p.id}:${p.name}(${p.pos},${p.age})`).join(', '));
  console.log(`${team} 2025-26 contracts:`, contracts25.map(c => `${c.playerId}:$${(c.aav/1e6).toFixed(2)}M`).join(', '));
});
