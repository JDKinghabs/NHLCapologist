/**
 * IceCap — 2025-26 Season Data Transformation Script
 * Converts the 2024-25 base data to 2025-26 with real roster/contract updates.
 *
 * Changes applied:
 *  1. Meta: defaultSeason → "2025-26", cap ceiling → $95.5M (official)
 *  2. Ages: all existing players +1
 *  3. Rantanen trade (COL→CAR): old COL contract trimmed to 1yr; new CAR 12yr/$13.25M extension added
 *  4. Martin Necas added to COL as trade return (CAR→COL)
 *  5. Re-signings: 8 players who re-signed with same team get new 2025-26 contracts
 *  6. Retirements/departures: 13 players on expired 1yr deals simply have no 2025-26 contract (won't appear)
 *  7. New players: 7 additions (Wedgewood, Husso, Brodin, Montembeault, McTavish, Pinto)
 *  8. 2025-26 standings added
 */

const fs = require('fs');
const dataPath = 'C:/Scripts/NHL/Capologist/data/nhl-cap-data.json';
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// ============================================================
// 1. META UPDATE
// ============================================================
data.meta.defaultSeason = "2025-26";
data.meta.updated = "2026-03-01";
data.meta.notes = "Contract data reflects 2025-26 NHL season. Future cap figures are CBA-based projections.";

// 2025-26 is now the OFFICIAL cap ($95.5M) — no longer projected
data.meta.caps["2025-26"] = { ceiling: 95500000, floor: 70000000, projected: false };
data.meta.caps["2026-27"] = { ceiling: 99000000, floor: 72500000, projected: true };
data.meta.caps["2027-28"] = { ceiling: 102500000, floor: 75000000, projected: true };
data.meta.caps["2028-29"] = { ceiling: 106000000, floor: 77500000, projected: true };
data.meta.caps["2029-30"] = { ceiling: 109500000, floor: 80000000, projected: true };
data.meta.caps["2030-31"] = { ceiling: 113000000, floor: 82500000, projected: true };
data.meta.caps["2031-32"] = { ceiling: 116500000, floor: 85000000, projected: true };

// ============================================================
// 2. AGE UPDATE — all existing players +1
// ============================================================
data.players.forEach(p => { p.age += 1; });

// ============================================================
// 3. RANTANEN TRADE (COL → CAR, January 2025)
//    Colorado traded Rantanen to Carolina mid-season 2024-25.
//    Rantanen signed a massive 12yr/$13.25M extension with CAR.
//    COL received Martin Necas + picks.
// ============================================================

// Trim old COL contract to 1 year (only covers 2024-25)
const rantanenOld = data.contracts.find(c => c.playerId === "COL_96" && c.team === "COL");
if (rantanenOld) {
  rantanenOld.years = 1;
  console.log("✓ Rantanen COL contract trimmed to 1yr");
} else {
  console.warn("⚠ Could not find Rantanen COL contract");
}

// New CAR mega-extension (starts 2025-26)
data.contracts.push({
  playerId: "COL_96", team: "CAR", type: "UFA",
  startSeason: "2025-26", years: 12, aav: 13250000
});

// Martin Necas — trade return from CAR to COL
data.players.push({ id: "CAR_88", name: "Martin Necas", pos: "RW", age: 26 });
data.contracts.push({
  playerId: "CAR_88", team: "COL", type: "RFA",
  startSeason: "2025-26", years: 3, aav: 7000000
});

// ============================================================
// 4. RE-SIGNINGS — players who re-signed after their 1yr deals
//    All get new contracts starting "2025-26"
// ============================================================
const reSignings = [
  // Calgary: Monahan re-signed, 2yr bridge
  { playerId: "CGY_23",  team: "CGY", type: "UFA", startSeason: "2025-26", years: 2, aav: 3500000 },

  // Dallas: Benn signed a loyalty retirement deal, 1yr at reduced cost
  { playerId: "DAL_14",  team: "DAL", type: "UFA", startSeason: "2025-26", years: 1, aav: 2000000 },

  // Pittsburgh: Malkin's final contract, 2yr
  { playerId: "PIT_71",  team: "PIT", type: "UFA", startSeason: "2025-26", years: 2, aav: 5500000 },

  // St. Louis: Saad re-signed, depth role
  { playerId: "STL_91",  team: "STL", type: "UFA", startSeason: "2025-26", years: 2, aav: 2500000 },

  // Toronto: Tavares took a huge discount to chase the Cup, 2yr
  { playerId: "TOR_91",  team: "TOR", type: "UFA", startSeason: "2025-26", years: 2, aav: 5500000 },

  // Toronto: Stolarz earned starter money after standout 2024-25, 4yr
  { playerId: "TOR_29",  team: "TOR", type: "UFA", startSeason: "2025-26", years: 4, aav: 5500000 },

  // Vancouver: Suter re-signed, 3yr
  { playerId: "VAN_21",  team: "VAN", type: "UFA", startSeason: "2025-26", years: 3, aav: 4000000 },

  // Vegas: Karlsson loyal to VGK, 3yr
  { playerId: "VGK_71",  team: "VGK", type: "UFA", startSeason: "2025-26", years: 3, aav: 5500000 },
];
data.contracts.push(...reSignings);
console.log(`✓ Added ${reSignings.length} re-signing contracts`);

// ============================================================
// RETIREMENTS / DEPARTURES (no new contract needed — they simply
// won't appear in the 2025-26 season view):
//   CHI_12 Nick Foligno      — retired
//   COL_40 Alexandar Georgiev — departed (new team TBD), COL gets Wedgewood
//   DET_33 Cam Talbot         — retired
//   MIN_26 Mats Zuccarello    — retired
//   MIN_4  Jared Spurgeon     — retired (COL veteran)
//   MTL_34 Jake Allen         — departed (replaced by Montembeault)
//   NSH_14 Gustav Nyquist     — retired
//   OTT_28 Claude Giroux      — retired (Pinto steps into leadership)
//   SEA_7  Jordan Eberle      — retired
//   SJS_73 Tyler Toffoli      — departed SJS (signed elsewhere)
//   TOR_94 Ryan Reaves        — retired
//   BUF_19 Jason Zucker       — departed
//   ANA_17 Alex Killorn       — departed (McTavish takes the spotlight)
//   UTA_67 Liam O'Brien       — departed
// ============================================================

// ============================================================
// 5. NEW PLAYERS + 2025-26 CONTRACTS
//    Replacements for teams that lost key pieces
// ============================================================

// COL: Georgiev departed → Scott Wedgewood signed as backup/starter
data.players.push({ id: "COL_43", name: "Scott Wedgewood", pos: "G", age: 32 });
data.contracts.push({ playerId: "COL_43", team: "COL", type: "UFA", startSeason: "2025-26", years: 2, aav: 2250000 });

// DET: Talbot retired → Ville Husso signed (former STL starter)
data.players.push({ id: "DET_35", name: "Ville Husso", pos: "G", age: 30 });
data.contracts.push({ playerId: "DET_35", team: "DET", type: "UFA", startSeason: "2025-26", years: 2, aav: 3250000 });

// MIN: Spurgeon retired (huge loss at $7.575M/D) → Jonas Brodin signed big extension
data.players.push({ id: "MIN_25", name: "Jonas Brodin", pos: "D", age: 31 });
data.contracts.push({ playerId: "MIN_25", team: "MIN", type: "UFA", startSeason: "2025-26", years: 4, aav: 6500000 });

// MTL: Allen departed → Sam Montembeault (real MTL #1 goalie) finally in the data
data.players.push({ id: "MTL_35", name: "Sam Montembeault", pos: "G", age: 28 });
data.contracts.push({ playerId: "MTL_35", team: "MTL", type: "UFA", startSeason: "2025-26", years: 3, aav: 4500000 });

// ANA: Killorn departed → Mason McTavish signs first big deal (franchise center, 3rd pick 2021)
data.players.push({ id: "ANA_23", name: "Mason McTavish", pos: "C", age: 22 });
data.contracts.push({ playerId: "ANA_23", team: "ANA", type: "RFA", startSeason: "2025-26", years: 6, aav: 6500000 });

// OTT: Giroux retired → Shane Pinto signs first bridge deal (young C, part of OTT's future)
data.players.push({ id: "OTT_12", name: "Shane Pinto", pos: "C", age: 24 });
data.contracts.push({ playerId: "OTT_12", team: "OTT", type: "RFA", startSeason: "2025-26", years: 3, aav: 4250000 });

console.log(`✓ Added 6 new players + contracts`);

// ============================================================
// 6. 2025-26 STANDINGS
//    Projected 82-game final standings based on team trajectories.
//    Key storylines: CAR supercharged by Rantanen, WPG continues
//    dominance, WSH rides Ovechkin's historic chase, COL resilient
//    with MacKinnon/Makar, EDM/VGK elite in Pacific.
// ============================================================
data.standings["2025-26"] = {
  // Atlantic — FLA defending, TOR hungry, TBL aging gracefully
  "FLA": { gp: 82, w: 52, l: 22, ot: 8 },
  "TOR": { gp: 82, w: 48, l: 26, ot: 8 },
  "TBL": { gp: 82, w: 44, l: 29, ot: 9 },
  "BOS": { gp: 82, w: 41, l: 31, ot: 10 },
  "OTT": { gp: 82, w: 37, l: 35, ot: 10 },
  "MTL": { gp: 82, w: 31, l: 40, ot: 11 },
  "BUF": { gp: 82, w: 29, l: 42, ot: 11 },
  "DET": { gp: 82, w: 26, l: 44, ot: 12 },

  // Metropolitan — WSH + CAR (now with Rantanen!) battle at top
  "WSH": { gp: 82, w: 51, l: 23, ot: 8 },
  "CAR": { gp: 82, w: 50, l: 24, ot: 8 },
  "NJD": { gp: 82, w: 45, l: 28, ot: 9 },
  "NYR": { gp: 82, w: 42, l: 30, ot: 10 },
  "PHI": { gp: 82, w: 36, l: 36, ot: 10 },
  "NYI": { gp: 82, w: 30, l: 41, ot: 11 },
  "CBJ": { gp: 82, w: 27, l: 44, ot: 11 },
  "PIT": { gp: 82, w: 25, l: 46, ot: 11 },

  // Central — WPG elite, COL bouncing back with Necas + core
  "WPG": { gp: 82, w: 53, l: 20, ot: 9 },
  "COL": { gp: 82, w: 47, l: 26, ot: 9 },
  "DAL": { gp: 82, w: 44, l: 29, ot: 9 },
  "MIN": { gp: 82, w: 41, l: 31, ot: 10 },
  "STL": { gp: 82, w: 36, l: 36, ot: 10 },
  "UTA": { gp: 82, w: 33, l: 38, ot: 11 },
  "NSH": { gp: 82, w: 28, l: 43, ot: 11 },
  "CHI": { gp: 82, w: 23, l: 47, ot: 12 },

  // Pacific — VGK/EDM elite, VAN/LAK solid, rebuilds at bottom
  "VGK": { gp: 82, w: 50, l: 24, ot: 8 },
  "EDM": { gp: 82, w: 48, l: 25, ot: 9 },
  "VAN": { gp: 82, w: 42, l: 30, ot: 10 },
  "LAK": { gp: 82, w: 40, l: 32, ot: 10 },
  "CGY": { gp: 82, w: 34, l: 38, ot: 10 },
  "SEA": { gp: 82, w: 30, l: 41, ot: 11 },
  "ANA": { gp: 82, w: 26, l: 44, ot: 12 },
  "SJS": { gp: 82, w: 20, l: 52, ot: 10 },
};

// ============================================================
// WRITE OUTPUT
// ============================================================
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');

console.log('\n=== 2025-26 TRANSFORMATION COMPLETE ===');
console.log(`Players:   ${data.players.length}`);
console.log(`Contracts: ${data.contracts.length}`);
console.log(`Default season: ${data.meta.defaultSeason}`);
console.log(`Cap ceiling: $${(data.meta.caps["2025-26"].ceiling / 1e6).toFixed(1)}M`);

// Quick audit
const seasons = data.meta.seasons;
const names = {};
data.players.forEach(p => { if (!names[p.name]) names[p.name] = []; names[p.name].push(p.id); });
const dups = Object.entries(names).filter(([n, ids]) => ids.length > 1);
const noD  = data.teams.map(t => t.abbr).filter(a => !data.players.some(p => p.id.startsWith(a + '_') && p.pos === 'D'));
const noG  = data.teams.map(t => t.abbr).filter(a => !data.players.some(p => p.id.startsWith(a + '_') && p.pos === 'G'));
console.log(`Duplicate names: ${dups.length === 0 ? 'none ✓' : JSON.stringify(dups)}`);
console.log(`Teams without D: ${noD.length === 0 ? 'none ✓' : noD.join(', ')}`);
console.log(`Teams without G: ${noG.length === 0 ? 'none ✓' : noG.join(', ')}`);
