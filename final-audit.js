const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Scripts/NHL/Capologist/data/nhl-cap-data.json','utf8'));
const seasons = data.meta.seasons;

function buildSeasonList(start, years, s) {
  const idx = s.indexOf(start); if (idx === -1) return []; return s.slice(idx, idx + years);
}

const playerMap = {};
data.players.forEach(p => { playerMap[p.id] = p; });

console.log('=== FINAL 2025-26 AUDIT ===');
console.log(`Default season : ${data.meta.defaultSeason}`);
console.log(`2025-26 ceiling: $${(data.meta.caps['2025-26'].ceiling/1e6).toFixed(1)}M (projected: ${data.meta.caps['2025-26'].projected})`);
console.log(`Players        : ${data.players.length}`);
console.log(`Contracts      : ${data.contracts.length}`);

// Per-team 2025-26 breakdown
const S = '2025-26';
console.log('\nTeam | Contracts | Payroll     | F  D  G | Notes');
console.log('-----|-----------|-------------|---------|-------');

const teamSummaries = [];
data.teams.forEach(t => {
  const active = data.contracts.filter(c => c.team === t.abbr && buildSeasonList(c.startSeason, c.years, seasons).includes(S));
  const payroll = active.reduce((sum, c) => sum + c.aav, 0);
  const counts = { F: 0, D: 0, G: 0 };
  active.forEach(c => { const p = playerMap[c.playerId]; if (p) counts[p.pos === 'C' || p.pos === 'LW' || p.pos === 'RW' ? 'F' : p.pos] = (counts[p.pos === 'C' || p.pos === 'LW' || p.pos === 'RW' ? 'F' : p.pos] || 0) + 1; });
  const notes = [];
  if (counts.D === 0) notes.push('NO D');
  if (counts.G === 0) notes.push('NO G');
  if (active.length < 5) notes.push('THIN');
  teamSummaries.push({ abbr: t.abbr, n: active.length, payroll, counts, notes });
});

teamSummaries.sort((a,b) => b.payroll - a.payroll);
teamSummaries.forEach(s => {
  const flag = s.notes.length > 0 ? ' ⚠ ' + s.notes.join(', ') : '';
  console.log(`${s.abbr.padEnd(5)}| ${String(s.n).padEnd(9)} | $${(s.payroll/1e6).toFixed(2).padEnd(9)}M | ${s.counts.F||0}  ${s.counts.D||0}  ${s.counts.G||0}   |${flag}`);
});

// Key contract checks
console.log('\n=== KEY PLAYER LOCATIONS (2025-26) ===');
const keyChecks = [
  { id: 'COL_96', name: 'Rantanen',  expectedTeam: 'CAR' },
  { id: 'CAR_88', name: 'Necas',     expectedTeam: 'COL' },
  { id: 'NYR_93', name: 'Zibanejad', expectedTeam: 'NYR' },
  { id: 'NYR_45', name: 'Schneider', expectedTeam: 'NYR' },
  { id: 'TOR_19', name: 'McCabe',    expectedTeam: 'TOR' },
  { id: 'TOR_91', name: 'Tavares',   expectedTeam: 'TOR' },
  { id: 'TOR_29', name: 'Stolarz',   expectedTeam: 'TOR' },
  { id: 'PHI_6',  name: 'Sanheim',   expectedTeam: 'PHI' },
  { id: 'MIN_25', name: 'Brodin',    expectedTeam: 'MIN' },
];
keyChecks.forEach(k => {
  const contract = data.contracts.find(c => c.playerId === k.id && buildSeasonList(c.startSeason, c.years, seasons).includes(S));
  if (!contract) {
    console.log(`  ⚠ ${k.name} (${k.id}): NOT FOUND in 2025-26`);
  } else {
    const ok = contract.team === k.expectedTeam;
    console.log(`  ${ok ? '✓' : '⚠'} ${k.name}: ${contract.team} $${(contract.aav/1e6).toFixed(2)}M ${contract.type} ${ok ? '' : `(expected ${k.expectedTeam})`}`);
  }
});

// Name duplicates
const names = {};
data.players.forEach(p => { if (!names[p.name]) names[p.name] = []; names[p.name].push(p.id); });
const dups = Object.entries(names).filter(([n,ids]) => ids.length > 1);
console.log(`\nDuplicate player names: ${dups.length === 0 ? 'none ✓' : JSON.stringify(dups)}`);

// Standings check
const s26 = data.standings['2025-26'];
console.log(`\n2025-26 standings entries: ${s26 ? Object.keys(s26).length : 0}`);
const wrongGP = s26 ? Object.entries(s26).filter(([t,s]) => s.w+s.l+s.ot !== 82) : [];
if (wrongGP.length > 0) console.log('⚠ Wrong GP:', wrongGP); else console.log('All standings sum to 82 GP ✓');
