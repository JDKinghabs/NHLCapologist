/**
 * Contract overlap fixes after dedup pass:
 *
 *  CAR_88 Necas:  original 4yr CAR deal covers 2025-26 (should be 1yr only — he was traded)
 *  MIN_25 Brodin: added a new 2025-26 MIN contract but original 4yr deal already covers 2025-26 → remove new one
 *  ANA_23 McTavish: added a new 2025-26 ANA contract but original 3yr deal already covers 2025-26 → remove new one
 *                   (McTavish extension should start 2027-28 after current deal expires)
 */

const fs = require('fs');
const dataPath = 'C:/Scripts/NHL/Capologist/data/nhl-cap-data.json';
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// ---- 1. Necas CAR original deal: trim to 1yr (only 2024-25) ----
const necasCAR = data.contracts.find(c => c.playerId === 'CAR_88' && c.team === 'CAR' && c.startSeason === '2024-25');
if (necasCAR) {
  necasCAR.years = 1;
  console.log('✓ Necas CAR contract trimmed to 1yr (2024-25 only)');
}

// ---- 2. Remove duplicate MIN_25 2025-26 contract ($6.5M — original 4yr deal covers him) ----
const brodinDup = data.contracts.findIndex(c => c.playerId === 'MIN_25' && c.team === 'MIN' && c.startSeason === '2025-26');
if (brodinDup !== -1) {
  console.log('✓ Removed duplicate Brodin 2025-26 MIN contract ($6.5M) — original 4yr deal already covers 2025-26');
  data.contracts.splice(brodinDup, 1);
}

// ---- 3. Remove duplicate ANA_23 2025-26 contract ($6.5M — original 3yr deal covers him through 2026-27) ----
//    Re-add as a 2027-28 extension (when his current deal expires)
const mcTavishDup = data.contracts.findIndex(c => c.playerId === 'ANA_23' && c.team === 'ANA' && c.startSeason === '2025-26');
if (mcTavishDup !== -1) {
  console.log('✓ Removed duplicate McTavish 2025-26 ANA contract — original 3yr deal covers 2025-26 & 2026-27');
  data.contracts.splice(mcTavishDup, 1);
}
// Add McTavish extension starting 2027-28 (his first big deal after the bridge)
data.contracts.push({ playerId: 'ANA_23', team: 'ANA', type: 'UFA', startSeason: '2027-28', years: 7, aav: 8500000 });
console.log('✓ Added McTavish extension: 7yr/$8.5M starting 2027-28');

// ---- Final audit ----
const seasons = data.meta.seasons;
function buildSeasonList(start, years, seasonArr) {
  const idx = seasonArr.indexOf(start);
  if (idx === -1) return [];
  return seasonArr.slice(idx, idx + years);
}

const playerMap = {};
data.players.forEach(p => { playerMap[p.id] = p; });

// Check 2025-26 roster for each team — flag any player appearing twice
const teams = data.teams.map(t => t.abbr);
let issues = 0;
teams.forEach(team => {
  const active = data.contracts.filter(c => c.team === team && buildSeasonList(c.startSeason, c.years, seasons).includes('2025-26'));
  const playerIds = active.map(c => c.playerId);
  const dup = playerIds.filter((id, i) => playerIds.indexOf(id) !== i);
  if (dup.length > 0) {
    console.log(`⚠ ${team} has duplicate players in 2025-26: ${dup}`);
    issues++;
  }
});
if (issues === 0) console.log('\n✓ No teams have duplicate player entries in 2025-26');

// Count contracts by season
const s2526 = teams.flatMap(team =>
  data.contracts.filter(c => c.team === team && buildSeasonList(c.startSeason, c.years, seasons).includes('2025-26'))
).length;
console.log(`\nPlayers: ${data.players.length}`);
console.log(`Contracts: ${data.contracts.length}`);
console.log(`Active in 2025-26: ${s2526} across all teams`);

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
console.log('File saved. ✓');
