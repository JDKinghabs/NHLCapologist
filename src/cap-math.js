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

export function buildTeamData(data, season, capCeiling) {
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
