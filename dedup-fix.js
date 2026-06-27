/**
 * Deduplication + contract audit fix for the 2025-26 transformation.
 *
 * Issues found:
 *  1. CAR_88 Martin Necas  — was already in original 2024-25 data (correct player, wrong second entry)
 *  2. MIN_25 Jonas Brodin  — was already in original 2024-25 data
 *  3. ANA_23 Mason McTavish — was already in original 2024-25 data
 *
 * Fixes:
 *  - Remove the second (newly-added) player entry for each duplicate
 *    Keep the first entry (age already updated +1 by the transform script)
 *  - Check original contracts for these players and remove any truly duplicate 2025-26 contracts
 *  - Verify the Necas/Rantanen trade contract logic is clean
 */

const fs = require('fs');
const dataPath = 'C:/Scripts/NHL/Capologist/data/nhl-cap-data.json';
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// ---- 1. De-duplicate players array ----
// Keep first occurrence of each player ID, remove subsequent duplicates
const seenIds = new Set();
const cleanedPlayers = [];
data.players.forEach(p => {
  if (!seenIds.has(p.id)) {
    seenIds.add(p.id);
    cleanedPlayers.push(p);
  } else {
    console.log(`  Removed duplicate player: ${p.id} ${p.name} age=${p.age}`);
  }
});
data.players = cleanedPlayers;

// ---- 2. Check original contracts for the three pre-existing players ----
// and determine if we need to add new 2025-26 contracts for them
const ids = ['CAR_88', 'MIN_25', 'ANA_23'];
ids.forEach(id => {
  const contracts = data.contracts.filter(c => c.playerId === id);
  console.log(`\nContracts for ${id}:`);
  contracts.forEach(c => console.log(`  team=${c.team} type=${c.type} start=${c.startSeason} years=${c.years} aav=$${(c.aav/1e6).toFixed(2)}M`));
});

// ---- 3. Check for any duplicate contracts (same playerId+team+startSeason) ----
const seen = {};
const dupKeys = [];
data.contracts.forEach(c => {
  const k = `${c.playerId}|${c.team}|${c.startSeason}`;
  if (seen[k]) dupKeys.push(k);
  seen[k] = true;
});

if (dupKeys.length > 0) {
  console.log('\n⚠ Duplicate contracts found:', dupKeys);
  // Remove duplicate contracts, keeping first occurrence
  const seenContracts = new Set();
  data.contracts = data.contracts.filter(c => {
    const k = `${c.playerId}|${c.team}|${c.startSeason}`;
    if (seenContracts.has(k)) {
      console.log(`  Removed dup contract: ${k}`);
      return false;
    }
    seenContracts.add(k);
    return true;
  });
} else {
  console.log('\n✓ No duplicate contracts');
}

// ---- 4. Final audit ----
const names = {};
data.players.forEach(p => {
  if (!names[p.name]) names[p.name] = [];
  names[p.name].push(p.id);
});
const remainingDups = Object.entries(names).filter(([n, ids]) => ids.length > 1);

console.log('\n=== POST-FIX AUDIT ===');
console.log('Players:', data.players.length);
console.log('Contracts:', data.contracts.length);
console.log('Duplicate names:', remainingDups.length === 0 ? 'none ✓' : JSON.stringify(remainingDups));

// Check per-team for 2025-26
['CAR','MIN','ANA'].forEach(team => {
  const teamContracts26 = data.contracts.filter(c => c.team === team);
  const seasons = data.meta.seasons;
  const buildSeasonList = (start, years, seasonArr) => {
    const idx = seasonArr.indexOf(start);
    if (idx === -1) return [];
    return seasonArr.slice(idx, idx + years);
  };
  const active = teamContracts26.filter(c => buildSeasonList(c.startSeason, c.years, seasons).includes('2025-26'));
  const playerMap = {};
  data.players.forEach(p => playerMap[p.id] = p);
  console.log(`\n${team} 2025-26 active contracts (${active.length}):`);
  active.forEach(c => {
    const p = playerMap[c.playerId];
    console.log(`  ${p ? p.name : c.playerId} (${p ? p.pos : '?'}) $${(c.aav/1e6).toFixed(2)}M ${c.type}`);
  });
});

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
console.log('\nFile saved.');
