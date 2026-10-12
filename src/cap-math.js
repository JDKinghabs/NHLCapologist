// Cap math shared by the site and scripts/validate-data.mjs: which contracts
// count in a season and what each team's payroll comes to.

export function safeNum(n) {
  return typeof n === "number" && !Number.isNaN(n) ? n : 0;
}

// Contract seasons come from the start year, so contracts that began before
// the site's first season still resolve correctly.
export function seasonAt(season, offset) {
  const start = Number(season.slice(0, 4)) + offset;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function buildSeasonList(startSeason, years) {
  if(!startSeason || !years) return [];
  return Array.from({ length: years }, (_, i) => seasonAt(startSeason, i));
}

export function isActiveSeason(contract, season) {
  const list = buildSeasonList(contract.startSeason, contract.years);
  return list.includes(season);
}

export function capHitFor(contract, season) {
  if(!isActiveSeason(contract, season)) return 0;
  if(contract.capHits && contract.capHits[season] != null) return contract.capHits[season];
  if(contract.aav != null) return contract.aav;
  return 0;
}

export function totalValueFor(contract) {
  const list = buildSeasonList(contract.startSeason, contract.years);
  if(contract.capHits) {
    return list.reduce((s, season) => s + safeNum(contract.capHits[season]), 0);
  }
  if(contract.aav != null) return safeNum(contract.aav) * safeNum(contract.years);
  return 0;
}

export function yearsLeftFor(contract, season) {
  const list = buildSeasonList(contract.startSeason, contract.years);
  const idx = list.indexOf(season);
  if(idx === -1) return 0;
  return list.length - idx;
}

export function endSeasonFor(contract) {
  const list = buildSeasonList(contract.startSeason, contract.years);
  return list.length ? list[list.length - 1] : "";
}

export function getSeasonCapSheet(data, season, teamAbbr) {
  return data?.capSheets?.[season]?.[teamAbbr] || null;
}

export function buildPlayerRow(contract, player, season, item={}) {
  const total = totalValueFor(contract);
  const yearsLeft = yearsLeftFor(contract, season);
  const endSeason = endSeasonFor(contract);
  const aav = contract.aav != null ? contract.aav : (total && contract.years ? total / contract.years : 0);

  return {
    id: item.id || contract.playerId,
    playerId: contract.playerId,
    name: player.name,
    pos: player.pos || "-",
    age: player.age || "-",
    capHit: item.capHit != null ? safeNum(item.capHit) : capHitFor(contract, season),
    aav,
    years: yearsLeft,
    total,
    endSeason,
    expiryStatus: contract.expiryStatus || null,
    clause: item.clause || contract.clause || null,
    signingBonus: safeNum(item.signingBonus),
    incentives: safeNum(item.incentives),
    category: item.category || "active"
  };
}

export function summarizeAdjustmentBuckets(adjustments) {
  return adjustments.reduce((totals, adj) => {
    const key = adj.category || "other";
    totals[key] = (totals[key] || 0) + safeNum(adj.amount);
    return totals;
  }, {});
}

// LTIR relief. A team may go over the ceiling by the cap hits of its players
// on long-term injured reserve, less whatever cap space it had when they went
// on LTIR. Spotrac doesn't publish the payroll on each placement date, so this
// assumes it was today's payroll without the LTIR players; with that, a team
// over the ceiling but covered by LTIR uses exactly the relief it needs.
//   capStatus "under": at or under the ceiling (no relief needed)
//             "ltir":  over the ceiling, covered by LTIR relief
//             "over":  over the ceiling even with LTIR relief
export function ltirRelief({ payroll, ceiling, ltirCapHit }) {
  const P = safeNum(payroll);
  const C = safeNum(ceiling);
  const L = safeNum(ltirCapHit);
  if(!C) return { ltirCapHit: L, ltirPool: 0, spaceWithLtir: 0, capStatus: "under" };
  const ltirPool = Math.max(0, L - Math.max(0, C - (P - L)));
  const capStatus = P <= C ? "under" : P - L <= C ? "ltir" : "over";
  return { ltirCapHit: L, ltirPool, spaceWithLtir: C + ltirPool - P, capStatus };
}

export function buildTeamData(data, season, capCeiling) {
  const currentSeason = data.meta?.defaultSeason || data.meta?.seasons?.[0];
  const playersById = Object.fromEntries((data.players || []).map(p => [p.id, p]));
  const contractsByTeam = {};
  const contractLookup = {};

  (data.contracts || []).forEach((contract) => {
    if(!isActiveSeason(contract, season)) return;
    const capHit = capHitFor(contract, season);
    if(capHit <= 0) return;
    if(!contractsByTeam[contract.team]) contractsByTeam[contract.team] = [];
    contractsByTeam[contract.team].push(contract);
    contractLookup[`${contract.team}:${contract.playerId}`] = contract;
  });

  return (data.teams || []).map(team => {
    const capSheet = getSeasonCapSheet(data, season, team.abbr);
    const sheetItems = Array.isArray(capSheet?.items) ? capSheet.items : [];
    const sheetAdjustments = Array.isArray(capSheet?.adjustments) ? capSheet.adjustments : [];
    const roster = [];

    if(sheetItems.length > 0) {
      sheetItems.forEach((item) => {
        if(item.kind !== "player" || !item.playerId) return;
        const contract = contractLookup[`${team.abbr}:${item.playerId}`];
        if(!contract) return;
        const player = playersById[item.playerId] || { name: item.playerId || "Unknown", pos: "-" };
        const row = buildPlayerRow(contract, player, season, item);
        if(row.capHit > 0) roster.push(row);
      });
    } else {
      (contractsByTeam[team.abbr] || []).forEach((contract) => {
        const player = playersById[contract.playerId] || { name: contract.playerId || "Unknown", pos: "-" };
        const row = buildPlayerRow(contract, player, season);
        if(row.capHit > 0) roster.push(row);
      });
    }

    roster.sort((a,b) => b.capHit - a.capHit);
    const adjustments = sheetAdjustments.map((adj, idx) => ({
      id: adj.id || `${team.abbr}-adj-${idx}`,
      label: adj.label || adj.playerId || "Adjustment",
      category: adj.category || "other",
      amount: safeNum(adj.amount),
      notes: adj.notes || ""
    }));
    const playerCap = roster.reduce((s,p) => s + safeNum(p.capHit), 0);
    const adjustmentCap = adjustments.reduce((s,adj) => s + safeNum(adj.amount), 0);
    const payroll = playerCap + adjustmentCap;
    const space = capCeiling ? capCeiling - payroll : 0;
    // LTIR is a current-season status; later seasons get no relief.
    const ltirCapHit = season === currentSeason
      ? roster.filter(p => p.category === "ltir").reduce((s, p) => s + safeNum(p.capHit), 0)
      : 0;
    const ltir = ltirRelief({ payroll, ceiling: capCeiling, ltirCapHit });
    const rosterCounts = roster.reduce((counts, player) => {
      counts[player.category] = (counts[player.category] || 0) + 1;
      return counts;
    }, {});
    return {
      ...team,
      color: team.colors?.primary || "#8aacbe",
      alt: team.colors?.alt || "#0d1117",
      payroll,
      space,
      ...ltir,
      playerCap,
      adjustmentCap,
      adjustments,
      adjustmentBuckets: summarizeAdjustmentBuckets(adjustments),
      rosterCounts,
      capSheetStatus: capSheet?.status || (sheetItems.length > 0 ? "reviewed" : "derived"),
      trackingSource: sheetItems.length > 0 ? "capSheet" : "contracts",
      roster
    };
  });
}
