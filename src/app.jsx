const { useState, useMemo, useEffect, useRef } = React;

function safeNum(n) {
  return typeof n === "number" && !Number.isNaN(n) ? n : 0;
}

function fmt(n, compact=false) {
  const num = safeNum(n);
  if(compact) {
    if(Math.abs(num) >= 1_000_000) return (num/1_000_000).toFixed(1) + "M";
    return (num/1000).toFixed(0) + "K";
  }
  return "$" + num.toLocaleString("en-US");
}

function fmtM(n) {
  const num = safeNum(n);
  return "$" + (num/1_000_000).toFixed(2) + "M";
}

function seasonIndex(season, seasons) {
  return seasons.indexOf(season);
}

function buildSeasonList(startSeason, years, seasons) {
  if(!startSeason || !years) return [];
  const startIdx = seasonIndex(startSeason, seasons);
  if(startIdx === -1) return [];
  return seasons.slice(startIdx, startIdx + years);
}

function isActiveSeason(contract, season, seasons) {
  const list = buildSeasonList(contract.startSeason, contract.years, seasons);
  return list.includes(season);
}

function capHitFor(contract, season, seasons) {
  if(!isActiveSeason(contract, season, seasons)) return 0;
  if(contract.capHits && contract.capHits[season] != null) return contract.capHits[season];
  if(contract.aav != null) return contract.aav;
  return 0;
}

function totalValueFor(contract, seasons) {
  const list = buildSeasonList(contract.startSeason, contract.years, seasons);
  if(contract.capHits) {
    return list.reduce((s, season) => s + safeNum(contract.capHits[season]), 0);
  }
  if(contract.aav != null) return safeNum(contract.aav) * safeNum(contract.years);
  return 0;
}

function yearsLeftFor(contract, season, seasons) {
  const list = buildSeasonList(contract.startSeason, contract.years, seasons);
  const idx = list.indexOf(season);
  if(idx === -1) return 0;
  return list.length - idx;
}

function endSeasonFor(contract, seasons) {
  const list = buildSeasonList(contract.startSeason, contract.years, seasons);
  return list.length ? list[list.length - 1] : "";
}

function getBarClass(pct) {
  if(pct >= 100) return "over";
  if(pct >= 92)  return "warning";
  if(pct >= 80)  return "ok";
  return "great";
}

function getSpaceColor(space) {
  if(space < 0) return "high-cap";
  if(space < 3_000_000) return "med-cap";
  return "low-cap";
}

function getSeasonCapSheet(data, season, teamAbbr) {
  return data?.capSheets?.[season]?.[teamAbbr] || null;
}

function buildPlayerRow(contract, player, season, seasons, item={}) {
  const total = totalValueFor(contract, seasons);
  const yearsLeft = yearsLeftFor(contract, season, seasons);
  const endSeason = endSeasonFor(contract, seasons);
  const aav = contract.aav != null ? contract.aav : (total && contract.years ? total / contract.years : 0);

  return {
    id: item.id || contract.playerId,
    playerId: contract.playerId,
    name: player.name,
    pos: player.pos || "-",
    age: player.age || "-",
    capHit: item.capHit != null ? safeNum(item.capHit) : capHitFor(contract, season, seasons),
    aav,
    years: yearsLeft,
    total,
    endSeason,
    type: contract.type || "UFA",
    category: item.category || "active"
  };
}

function summarizeAdjustmentBuckets(adjustments) {
  return adjustments.reduce((totals, adj) => {
    const key = adj.category || "other";
    totals[key] = (totals[key] || 0) + safeNum(adj.amount);
    return totals;
  }, {});
}

function buildTeamData(data, season, capCeiling) {
  const seasons = data.meta?.seasons || [];
  const playersById = Object.fromEntries((data.players || []).map(p => [p.id, p]));
  const contractsByTeam = {};
  const contractLookup = {};

  (data.contracts || []).forEach((contract) => {
    if(!isActiveSeason(contract, season, seasons)) return;
    const capHit = capHitFor(contract, season, seasons);
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
        const row = buildPlayerRow(contract, player, season, seasons, item);
        if(row.capHit > 0) roster.push(row);
      });
    } else {
      (contractsByTeam[team.abbr] || []).forEach((contract) => {
        const player = playersById[contract.playerId] || { name: contract.playerId || "Unknown", pos: "-" };
        const row = buildPlayerRow(contract, player, season, seasons);
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

function TeamCard({ team, capCeiling, selected, onClick }) {
  const pct = capCeiling ? Math.min((team.payroll / capCeiling) * 100, 105) : 0;
  const div = team.division || "—";
  const F = team.roster.filter(p=>["C","LW","RW"].includes(p.pos)).length;
  const D = team.roster.filter(p=>p.pos==="D").length;
  const G = team.roster.filter(p=>p.pos==="G").length;
  return (
    <div className={`team-card ${selected?"selected":""}`}
         style={{"--team-color": team.color}}
         onClick={onClick}>
      <div className="card-header">
        <div className="team-abbr" style={{color: team.color}}>{team.abbr}</div>
        <div className="team-name-block">
          <div className="team-full-name">{team.name}</div>
          <div className="team-division">{div} Division</div>
        </div>
        <div>
          <div className={`cap-space-num ${getSpaceColor(team.space)}`}>
            {team.space < 0 ? "-" : "+"}{fmt(Math.abs(team.space), true)}
          </div>
          <div className="cap-space-label">Cap Space</div>
        </div>
      </div>
      <div className="cap-bar-wrap">
        <div className="cap-bar-track">
          <div className={`cap-bar-fill ${getBarClass(pct)}`}
               style={{width: `${Math.min(pct,100)}%`}} />
        </div>
        <div className="cap-stats">
          <div className="cap-stat">
            <div className="cap-stat-val">{fmtM(team.payroll)}</div>
            <div className="cap-stat-lbl">Payroll</div>
          </div>
          <div className="cap-stat" style={{textAlign:"center"}}>
            <div className="cap-stat-val">{pct.toFixed(1)}%</div>
            <div className="cap-stat-lbl">Cap Used</div>
          </div>
          <div className="cap-stat" style={{textAlign:"right"}}>
            <div className="cap-stat-val">{team.roster.length}</div>
            <div className="cap-stat-lbl">Tracked</div>
          </div>
        </div>
      </div>
      <div className="roster-row">
        <div className="roster-pill"><span>{F}</span>F</div>
        <div className="roster-pill"><span>{D}</span>D</div>
        <div className="roster-pill"><span>{G}</span>G</div>
      </div>
    </div>
  );
}

function ContractsTable({ players, capCeiling, sortKey, setSortKey, sortDir, setSortDir }) {
  function handleSort(key) {
    if(sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const cols = [
    { key:"name",      label:"Player",      cls:"" },
    { key:"category",  label:"Bucket",      cls:"" },
    { key:"pos",       label:"POS",         cls:"" },
    { key:"age",       label:"Age",         cls:"num" },
    { key:"capHit",    label:"Cap Hit",     cls:"num" },
    { key:"aav",       label:"AAV",         cls:"num" },
    { key:"years",     label:"Yrs Left",    cls:"num" },
    { key:"endSeason", label:"Ends",        cls:"" },
    { key:"total",     label:"Total Value", cls:"num" },
    { key:"type",      label:"Status",      cls:"" }
  ];
  const arrow = (k) => sortKey===k ? (sortDir==="desc"?"↓":"↑") : "";

  if(players.length === 0) {
    return <div className="empty-state">No contracts loaded for this season.</div>;
  }

  return (
    <div style={{overflowX:"auto"}}>
      <table className="contracts-table">
        <thead>
          <tr>
            {cols.map(c=> (
              <th key={c.key} className={c.cls} onClick={()=>handleSort(c.key)}>
                {c.label} {arrow(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const pct = capCeiling ? (p.capHit / capCeiling) * 100 : 0;
            return (
              <tr key={p.id}>
                <td><span className="player-name">{p.name}</span></td>
                <td><span className={`cap-category ${p.category}`}>{p.category}</span></td>
                <td><span className="player-name mono" style={{fontSize:12,color:"var(--text3)"}}>{p.pos}</span></td>
                <td className="num mono">{p.age}</td>
                <td className="num">
                  <span className={`mono ${pct>=10?"high-cap":pct>=6?"med-cap":"low-cap"}`}>
                    {fmtM(p.capHit)}
                  </span>
                  <span className="cap-pct">{pct.toFixed(1)}%</span>
                </td>
                <td className="num mono" style={{color:"var(--text3)"}}>{fmtM(p.aav)}</td>
                <td className="num mono">{p.years}yr</td>
                <td className="mono" style={{color:"var(--text3)"}}>{p.endSeason || "-"}</td>
                <td className="num mono" style={{color:"var(--text3)"}}>{fmtM(p.total)}</td>
                <td>
                  <span className={`contract-type type-${p.type.toLowerCase()}`}>{p.type}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TeamDetail({ team, capCeiling, onClose }) {
  const [tab, setTab] = useState("all");
  const [sortKey, setSortKey] = useState("capHit");
  const [sortDir, setSortDir] = useState("desc");

  const filtered = useMemo(() => {
    let p = [...team.roster];
    if(tab === "forwards")  p = p.filter(x=>["C","LW","RW"].includes(x.pos));
    if(tab === "defense")   p = p.filter(x=>x.pos==="D");
    if(tab === "goalies")   p = p.filter(x=>x.pos==="G");
    if(tab === "expiring")  p = p.filter(x=>x.years<=1);

    p.sort((a,b) => {
      const av = a[sortKey], bv = b[sortKey];
      if(typeof av === "string") return sortDir==="desc" ? bv.localeCompare(av) : av.localeCompare(bv);
      return sortDir==="desc" ? (bv - av) : (av - bv);
    });
    return p;
  }, [team, tab, sortKey, sortDir]);

  const tabs = [
    {id:"all",      label:"All Contracts"},
    {id:"forwards", label:"Forwards"},
    {id:"defense",  label:"Defense"},
    {id:"goalies",  label:"Goalies"},
    {id:"expiring", label:"Expiring"}
  ];

  const pct = capCeiling ? (team.payroll/capCeiling) * 100 : 0;

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div className="detail-abbr" style={{color:team.color}}>{team.abbr}</div>
        <div className="detail-info">
          <h2>{team.name}</h2>
          <p>{team.division} Division · {team.roster.length} tracked player items · {team.capSheetStatus} cap sheet</p>
        </div>
        <div className="detail-caps">
          <div className="detail-cap-item">
            <div className="detail-cap-val" style={{color:"var(--text)"}}>{fmtM(team.payroll)}</div>
            <div className="detail-cap-lbl">Cap Commitments</div>
          </div>
          <div className="detail-cap-item">
            <div className={`detail-cap-val ${team.space<0?"high-cap":""}`}>
              {team.space<0?"-":"+"}{fmtM(Math.abs(team.space))}
            </div>
            <div className="detail-cap-lbl">Cap Space</div>
          </div>
          <div className="detail-cap-item">
            <div className="detail-cap-val" style={{color: pct>=92?"var(--yellow)":"var(--text2)"}}>
              {pct.toFixed(1)}%
            </div>
            <div className="detail-cap-lbl">Cap Used</div>
          </div>
        </div>
        <button className="close-btn" onClick={onClose}>✕</button>
      </div>
      <div style={{padding:"14px 18px",borderBottom:"1px solid var(--border)",display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <span className="data-badge dim">Players: {fmtM(team.playerCap)}</span>
        <span className="data-badge dim">Adjustments: {fmtM(team.adjustmentCap)}</span>
        {Object.entries(team.rosterCounts).sort((a,b) => a[0].localeCompare(b[0])).map(([category, count]) => (
          <span key={category} className={`cap-category ${category}`}>{category}: {count}</span>
        ))}
        {team.adjustments.map(adj => (
          <span key={adj.id} className="data-badge warn">{adj.category}: {fmtM(adj.amount)}</span>
        ))}
      </div>
      <div className="contracts-wrap">
        <div className="contracts-tabs">
          {tabs.map(t => (
            <div key={t.id} className={`ctab ${tab===t.id?"active":""}`}
                 onClick={()=>setTab(t.id)}>{t.label}</div>
          ))}
        </div>
        <ContractsTable
          players={filtered}
          capCeiling={capCeiling}
          sortKey={sortKey} setSortKey={setSortKey}
          sortDir={sortDir} setSortDir={setSortDir}
        />
      </div>
    </div>
  );
}

const STD_DIVISIONS = ["Atlantic", "Metropolitan", "Central", "Pacific"];
const STD_EAST = ["Atlantic", "Metropolitan"];
const STD_WEST = ["Central", "Pacific"];

function computeStandings(teamData, data, season) {
  const raw = data.standings?.[season] || {};
  const enriched = teamData.map(t => {
    const s = raw[t.abbr];
    if (!s) return { ...t, gp: 0, w: 0, l: 0, ot: 0, pts: 0, ptsPct: 0, hasStandings: false };
    const pts = safeNum(s.w) * 2 + safeNum(s.ot);
    const ptsPct = s.gp > 0 ? pts / (s.gp * 2) : 0;
    return { ...t, gp: s.gp, w: s.w, l: s.l, ot: s.ot, pts, ptsPct, hasStandings: true };
  });
  const byDiv = {};
  STD_DIVISIONS.forEach(div => {
    byDiv[div] = enriched
      .filter(t => t.division === div)
      .sort((a, b) => b.pts - a.pts || b.ptsPct - a.ptsPct || a.abbr.localeCompare(b.abbr));
  });
  const playoff = new Set();
  const wildcard = new Set();
  STD_DIVISIONS.forEach(div => byDiv[div].slice(0, 3).forEach(t => playoff.add(t.abbr)));
  [STD_EAST, STD_WEST].forEach(conf => {
    enriched
      .filter(t => conf.includes(t.division) && !playoff.has(t.abbr) && t.hasStandings)
      .sort((a, b) => b.pts - a.pts || b.ptsPct - a.ptsPct)
      .slice(0, 2)
      .forEach(t => wildcard.add(t.abbr));
  });
  return { enriched, byDiv, playoff, wildcard };
}

function StdTeamCell({ team, wildcard }) {
  return (
    <div className="std-team-cell">
      <div className="std-team-bar" style={{background: team.color}}/>
      <span className="std-abbr" style={{color: team.color}}>{team.abbr}</span>
      <span className="std-name">{team.name}</span>
      {wildcard.has(team.abbr) && <span className="wc-badge">WC</span>}
    </div>
  );
}

function StdTable({ teams, wildcard, capCeiling, cutoffIdx, showDiv, onTeamClick, selectedTeamAbbr }) {
  if (!teams.some(t => t.hasStandings)) {
    return <div className="no-standings">No standings data for this season</div>;
  }
  return (
    <div style={{overflowX:"auto"}}>
      <table className="standings-table">
        <thead>
          <tr>
            <th style={{width:28,textAlign:"right"}}>#</th>
            <th>Team</th>
            {showDiv && <th className="snum" style={{fontSize:9}}>DIV</th>}
            <th className="snum">GP</th>
            <th className="snum">W</th>
            <th className="snum">L</th>
            <th className="snum">OT</th>
            <th className="snum">PTS</th>
            <th className="snum">PTS%</th>
            <th className="snum">Payroll</th>
            <th className="snum">Space</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((team, i) => (
            <tr key={team.abbr}
                className={[i === cutoffIdx ? "playoff-cutoff-row" : "", team.abbr === selectedTeamAbbr ? "row-selected" : ""].filter(Boolean).join(" ")}
                onClick={() => onTeamClick && onTeamClick(team)}
                style={{cursor: onTeamClick ? "pointer" : "default"}}>
              <td style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:"var(--text3)",textAlign:"right"}}>{i+1}</td>
              <td><StdTeamCell team={team} wildcard={wildcard}/></td>
              {showDiv && <td className="snum" style={{fontSize:10,color:"var(--text3)"}}>{team.division?.slice(0,3).toUpperCase()}</td>}
              <td className="snum">{team.hasStandings ? team.gp : "—"}</td>
              <td className="snum">{team.hasStandings ? team.w : "—"}</td>
              <td className="snum">{team.hasStandings ? team.l : "—"}</td>
              <td className="snum">{team.hasStandings ? team.ot : "—"}</td>
              <td className="std-pts">{team.hasStandings ? team.pts : "—"}</td>
              <td className="snum">{team.ptsPct > 0 ? team.ptsPct.toFixed(3) : "—"}</td>
              <td className="snum">{fmtM(team.payroll)}</td>
              <td className={`snum ${getSpaceColor(team.space)}`}>{team.space < 0 ? "-" : "+"}{fmtM(Math.abs(team.space))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StandingsView({ teamData, data, season, capCeiling, onTeamClick, selectedTeam }) {
  const [mode, setMode] = useState("division");
  const { enriched, byDiv, playoff, wildcard } = useMemo(
    () => computeStandings(teamData, data, season),
    [teamData, data, season]
  );
  const hasData = enriched.some(t => t.hasStandings);
  const detailRef = useRef(null);
  useEffect(() => {
    if (selectedTeam && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedTeam?.abbr]);

  return (
    <div>
      <div className="filters" style={{marginBottom:16}}>
        {[["division","By Division"],["conference","By Conference"],["league","League-Wide"]].map(([v,l]) => (
          <button key={v} className={`filter-btn ${mode===v?"active":""}`} onClick={()=>setMode(v)}>{l}</button>
        ))}
      </div>
      {!hasData && (
        <div className="sample-banner">
          No standings data for {season}. Add a "standings" key to nhl-cap-data.json to populate this view.
        </div>
      )}
      {mode === "division" && (
        <div className="standings-grid">
          {STD_DIVISIONS.map(div => (
            <div key={div} className="standings-division">
              <div className="standings-div-header">
                <span className="standings-div-name">{div}</span>
                <span style={{fontSize:9,color:"var(--text3)",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase"}}>Division</span>
              </div>
              <StdTable teams={byDiv[div] || []} wildcard={wildcard} capCeiling={capCeiling} cutoffIdx={3} onTeamClick={onTeamClick} selectedTeamAbbr={selectedTeam?.abbr}/>
            </div>
          ))}
        </div>
      )}
      {mode === "conference" && (
        <div className="standings-conf-grid">
          {[["Eastern Conference", STD_EAST],["Western Conference", STD_WEST]].map(([name, divs]) => {
            const confTeams = enriched
              .filter(t => divs.includes(t.division))
              .sort((a, b) => b.pts - a.pts || b.ptsPct - a.ptsPct || a.abbr.localeCompare(b.abbr));
            return (
              <div key={name} className="standings-division">
                <div className="standings-div-header">
                  <span className="standings-div-name">{name}</span>
                </div>
                <StdTable teams={confTeams} wildcard={wildcard} capCeiling={capCeiling} cutoffIdx={8} onTeamClick={onTeamClick} selectedTeamAbbr={selectedTeam?.abbr}/>
              </div>
            );
          })}
        </div>
      )}
      {mode === "league" && (
        <div className="standings-division">
          <StdTable
            teams={[...enriched].sort((a,b) => b.pts - a.pts || b.ptsPct - a.ptsPct || a.abbr.localeCompare(b.abbr))}
            wildcard={wildcard}
            capCeiling={capCeiling}
            cutoffIdx={null}
            showDiv={true}
            onTeamClick={onTeamClick}
            selectedTeamAbbr={selectedTeam?.abbr}
          />
        </div>
      )}
      {selectedTeam && (
        <div ref={detailRef} style={{marginTop: 24}}>
          <CapSheetView team={selectedTeam} data={data} season={season} capCeiling={capCeiling} onClose={() => onTeamClick(selectedTeam)}/>
        </div>
      )}
    </div>
  );
}

function ProjectionsView({ teamData, data, capCeiling }) {
  const seasons = data?.meta?.seasons || [];
  const caps = data?.meta?.caps || {};
  const [selectedAbbrs, setSelectedAbbrs] = useState([]);
  const [showAll, setShowAll] = useState(true);
  const seasonCommitments = useMemo(() => {
    const map = {};
    seasons.forEach((season) => {
      const seasonCap = safeNum(caps[season]?.ceiling);
      map[season] = Object.fromEntries(
        buildTeamData(data, season, seasonCap).map(team => [team.abbr, team.payroll])
      );
    });
    return map;
  }, [data, seasons, caps]);

  const allAbbrs = teamData.map(t => t.abbr).sort();

  function toggleTeam(abbr) {
    setSelectedAbbrs(prev => prev.includes(abbr) ? prev.filter(a => a !== abbr) : [...prev, abbr]);
  }

  function getTeamCommitment(teamAbbr, season) {
    return safeNum(seasonCommitments?.[season]?.[teamAbbr]);
  }

  function getExpiringInSeason(teamAbbr, season) {
    const s = data.meta?.seasons || [];
    const idx = s.indexOf(season);
    if (idx === -1) return [];
    const nextSeason = s[idx + 1];
    if (!nextSeason) return [];
    return (data.contracts || [])
      .filter(c => c.team === teamAbbr)
      .filter(c => {
        const list = buildSeasonList(c.startSeason, c.years, s);
        return list.includes(season) && !list.includes(nextSeason);
      })
      .map(c => {
        const p = (data.players || []).find(pl => pl.id === c.playerId);
        return { name: p?.name || c.playerId, pos: p?.pos || "-", aav: c.aav };
      });
  }

  const teamsToShow = (showAll ? teamData : teamData.filter(t => selectedAbbrs.includes(t.abbr)))
    .sort((a,b) => a.abbr.localeCompare(b.abbr));

  return (
    <div>
      <div className="proj-controls">
        <button className={`filter-btn ${showAll ? "active" : ""}`} onClick={() => setShowAll(true)}>All Teams</button>
        <button className={`filter-btn ${!showAll ? "active" : ""}`} onClick={() => setShowAll(false)}>Pick Teams</button>
        {!showAll && allAbbrs.map(abbr => {
          const t = teamData.find(x => x.abbr === abbr);
          return (
            <button key={abbr}
              className={`filter-btn ${selectedAbbrs.includes(abbr) ? "active" : ""}`}
              style={selectedAbbrs.includes(abbr) ? {"--team-color": t?.color, borderColor: t?.color, color: t?.color, background: "rgba(0,0,0,0.2)"} : {}}
              onClick={() => toggleTeam(abbr)}>{abbr}</button>
          );
        })}
      </div>
      <div className="proj-grid">
        {seasons.map(season => {
          const capInfo = caps[season] || {};
          const ceiling = safeNum(capInfo.ceiling);
          return (
            <div key={season} className="proj-season-row">
              <div className="proj-season-header">
                <span className="proj-season-label">{season}</span>
                {capInfo.projected && <span className="proj-projected-badge">Projected</span>}
                <span className="proj-cap-label">Cap Ceiling</span>
                <span className="proj-cap-val">{fmtM(ceiling)}</span>
              </div>
              <div className="proj-bar-row">
                {teamsToShow.map(team => {
                  const committed = getTeamCommitment(team.abbr, season);
                  const pct = ceiling ? Math.min((committed / ceiling) * 100, 105) : 0;
                  const space = ceiling - committed;
                  const barClass = getBarClass(pct);
                  return (
                    <div key={team.abbr} className="proj-team-bar-wrap">
                      <span className="proj-team-tag" style={{color: team.color}}>{team.abbr}</span>
                      <div className="proj-bar-track">
                        <div className={`proj-bar-fill cap-bar-fill ${barClass}`} style={{width: `${Math.min(pct, 100)}%`}}>
                          {pct > 10 && <span className="proj-bar-fill-label">{fmtM(committed)}</span>}
                        </div>
                      </div>
                      <span className={`proj-space-val ${getSpaceColor(space)}`}>
                        {space < 0 ? "-" : "+"}{fmtM(Math.abs(space))}
                      </span>
                    </div>
                  );
                })}
              </div>
              {teamsToShow.length === 1 && (() => {
                const expiring = getExpiringInSeason(teamsToShow[0].abbr, season);
                if (!expiring.length) return null;
                return (
                  <div className="proj-expiry-row">
                    <span className="proj-expiry-label">Expiring:</span>
                    {expiring.map((p, i) => (
                      <span key={i} className="proj-expiry-pill">
                        <span>{p.pos}</span>{p.name} {fmtM(p.aav)}
                      </span>
                    ))}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TradeView({ teamData, data, capCeiling, season }) {
  const [teamA, setTeamA] = useState("TOR");
  const [teamB, setTeamB] = useState("EDM");
  const [selectedA, setSelectedA] = useState([]);
  const [selectedB, setSelectedB] = useState([]);
  const [tradeResult, setTradeResult] = useState(null);

  const seasons = data?.meta?.seasons || [];

  function getRoster(abbr) {
    return teamData.find(t => t.abbr === abbr)?.roster || [];
  }

  function togglePlayer(id, side) {
    if (side === "A") setSelectedA(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    else setSelectedB(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function getSelected(roster, ids) {
    return roster.filter(p => ids.includes(p.id));
  }

  function executeTrade() {
    const rA = getRoster(teamA);
    const rB = getRoster(teamB);
    const toB = getSelected(rA, selectedA);
    const toA = getSelected(rB, selectedB);
    const newA = rA.filter(p => !selectedA.includes(p.id)).concat(toA.map(p => ({...p, team: teamA})));
    const newB = rB.filter(p => !selectedB.includes(p.id)).concat(toB.map(p => ({...p, team: teamB})));
    const payA = newA.reduce((s,p) => s + safeNum(p.capHit), 0);
    const payB = newB.reduce((s,p) => s + safeNum(p.capHit), 0);
    setTradeResult({ teamA, teamB, payA, payB, toA, toB, prevPayA: rA.reduce((s,p)=>s+safeNum(p.capHit),0), prevPayB: rB.reduce((s,p)=>s+safeNum(p.capHit),0) });
  }

  function resetTrade() {
    setSelectedA([]); setSelectedB([]); setTradeResult(null);
  }

  const rosterA = getRoster(teamA);
  const rosterB = getRoster(teamB);
  const teamDataA = teamData.find(t => t.abbr === teamA);
  const teamDataB = teamData.find(t => t.abbr === teamB);

  const tradeDeltaA = getSelected(rosterB, selectedB).reduce((s,p) => s + safeNum(p.capHit), 0)
                    - getSelected(rosterA, selectedA).reduce((s,p) => s + safeNum(p.capHit), 0);
  const tradeDeltaB = -tradeDeltaA;

  const previewPayA = safeNum(teamDataA?.payroll) + tradeDeltaA;
  const previewPayB = safeNum(teamDataB?.payroll) + tradeDeltaB;
  const spaceA = capCeiling - previewPayA;
  const spaceB = capCeiling - previewPayB;

  const sameTeam = teamA === teamB;
  const canTrade = !sameTeam && (selectedA.length > 0 || selectedB.length > 0);
  const allTeamAbbrs = teamData.map(t => t.abbr).sort();

  function getValidity(space) {
    if (space < 0) return { cls: "err", label: "OVER CAP" };
    if (space < 3000000) return { cls: "warn", label: "TIGHT" };
    return { cls: "ok", label: "VALID" };
  }

  return (
    <div>
      <div className="trade-layout">
        <TradePanel
          side="A" abbr={teamA} roster={rosterA} selected={selectedA}
          onToggle={id => togglePlayer(id, "A")}
          onTeamChange={abbr => { setTeamA(abbr); setSelectedA([]); setTradeResult(null); }}
          allAbbrs={allTeamAbbrs} teamData={teamDataA} capCeiling={capCeiling}
        />
        <div className="trade-middle">
          <div className="trade-arrow">⇄</div>
          {sameTeam ? (
            <div className="trade-valid-badge warn" style={{textAlign:"center",padding:"8px 12px"}}>⚠ Select two<br/>different teams</div>
          ) : (
            <button className="trade-btn" disabled={!canTrade} onClick={executeTrade}>
              Execute Trade
            </button>
          )}
          <button className="trade-btn reset" onClick={resetTrade}>Reset</button>
          {canTrade && !tradeResult && (
            <div style={{textAlign:"center",marginTop:4}}>
              <div style={{fontSize:11,color:"var(--text3)",marginBottom:4,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:"0.06em",textTransform:"uppercase"}}>Preview</div>
              <span className={`trade-valid-badge ${getValidity(spaceA).cls}`}>{teamA}: {getValidity(spaceA).label}</span>
              <br/><br/>
              <span className={`trade-valid-badge ${getValidity(spaceB).cls}`}>{teamB}: {getValidity(spaceB).label}</span>
            </div>
          )}
        </div>
        <TradePanel
          side="B" abbr={teamB} roster={rosterB} selected={selectedB}
          onToggle={id => togglePlayer(id, "B")}
          onTeamChange={abbr => { setTeamB(abbr); setSelectedB([]); setTradeResult(null); }}
          allAbbrs={allTeamAbbrs} teamData={teamDataB} capCeiling={capCeiling}
        />
      </div>

      {(canTrade || tradeResult) && (
        <div className="trade-cap-summary">
          <div className="trade-summary-header" style={{display:"flex",alignItems:"center",gap:12}}>
            Trade Summary
            {tradeResult && <span className="proj-projected-badge" style={{fontFamily:"'Barlow Condensed',sans-serif"}}>EXECUTED</span>}
          </div>
          <div className="trade-summary-grid">
            {[
              { abbr: teamA, color: teamDataA?.color, prevPay: safeNum(teamDataA?.payroll), newPay: previewPayA, space: spaceA, players: getSelected(rosterA, selectedA), receiving: getSelected(rosterB, selectedB) },
              { abbr: teamB, color: teamDataB?.color, prevPay: safeNum(teamDataB?.payroll), newPay: previewPayB, space: spaceB, players: getSelected(rosterB, selectedB), receiving: getSelected(rosterA, selectedA) }
            ].map(t => {
              const delta = t.newPay - t.prevPay;
              const validity = getValidity(t.space);
              return (
                <div key={t.abbr} className="trade-summary-team">
                  <div className="trade-summary-abbr" style={{color: t.color}}>{t.abbr}</div>
                  {t.players.length > 0 && (
                    <div style={{marginBottom:10}}>
                      <div className="trade-selected-label">Sending</div>
                      {t.players.map(p => (
                        <div key={p.id} className="trade-selected-pill">
                          <span className="trade-selected-pill-pos">{p.pos}</span>
                          <span>{p.name}</span>
                          <span className="trade-selected-pill-cap">{fmtM(p.capHit)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {t.receiving.length > 0 && (
                    <div style={{marginBottom:10}}>
                      <div className="trade-selected-label">Receiving</div>
                      {t.receiving.map(p => (
                        <div key={p.id} className="trade-selected-pill">
                          <span className="trade-selected-pill-pos">{p.pos}</span>
                          <span>{p.name}</span>
                          <span className="trade-selected-pill-cap">{fmtM(p.capHit)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="trade-summary-row">
                    <span className="trade-summary-lbl">Current Payroll</span>
                    <span className="trade-summary-val">{fmtM(t.prevPay)}</span>
                  </div>
                  <div className="trade-summary-row">
                    <span className="trade-summary-lbl">Cap Delta</span>
                    <span className={`trade-summary-val ${delta > 0 ? "red" : delta < 0 ? "green" : ""}`}>
                      {delta >= 0 ? "+" : ""}{fmtM(delta)}
                    </span>
                  </div>
                  <div className="trade-summary-row">
                    <span className="trade-summary-lbl">New Payroll</span>
                    <span className="trade-summary-val">{fmtM(t.newPay)}</span>
                  </div>
                  <div className="trade-summary-row">
                    <span className="trade-summary-lbl">Cap Space</span>
                    <span className={`trade-summary-val ${t.space < 0 ? "red" : t.space < 3000000 ? "yellow" : "green"}`}>
                      {t.space < 0 ? "-" : "+"}{fmtM(Math.abs(t.space))}
                    </span>
                  </div>
                  <div className="trade-summary-row" style={{marginTop:8}}>
                    <span className="trade-summary-lbl">Status</span>
                    <span className={`trade-valid-badge ${validity.cls}`}>{validity.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TradePanel({ side, abbr, roster, selected, onToggle, onTeamChange, allAbbrs, teamData, capCeiling }) {
  const pct = capCeiling && teamData ? (teamData.payroll / capCeiling * 100) : 0;
  return (
    <div className="trade-panel">
      <div className="trade-panel-header">
        <span className="trade-panel-title">Team {side}</span>
        <select className="trade-team-select" value={abbr} onChange={e => onTeamChange(e.target.value)}>
          {allAbbrs.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      {teamData && (
        <div style={{padding:"10px 16px",borderBottom:"1px solid var(--border)",display:"flex",gap:16,alignItems:"center"}}>
          <div>
            <div style={{fontFamily:"'Space Mono',monospace",fontSize:12,color:"var(--text)"}}>{fmtM(teamData.payroll)}</div>
            <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:"0.06em"}}>Payroll</div>
          </div>
          <div>
            <div className={`mono ${getSpaceColor(teamData.space)}`} style={{fontSize:12}}>
              {teamData.space < 0 ? "-" : "+"}{fmtM(Math.abs(teamData.space))}
            </div>
            <div style={{fontSize:10,color:"var(--text3)",fontFamily:"'Barlow Condensed',sans-serif",textTransform:"uppercase",letterSpacing:"0.06em"}}>Space</div>
          </div>
          <div style={{flex:1}}>
            <div className="cap-bar-track" style={{marginBottom:0}}>
              <div className={`cap-bar-fill ${getBarClass(pct)}`} style={{width:`${Math.min(pct,100)}%`}}/>
            </div>
          </div>
          <div style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:"var(--text3)"}}>{pct.toFixed(1)}%</div>
        </div>
      )}
      {selected.length > 0 && (
        <div className="trade-selected-players">
          <div className="trade-selected-label">{selected.length} selected to trade</div>
          {roster.filter(p => selected.includes(p.id)).map(p => (
            <div key={p.id} className="trade-selected-pill">
              <span className="trade-selected-pill-pos">{p.pos}</span>
              <span>{p.name}</span>
              <span className="trade-selected-pill-cap">{fmtM(p.capHit)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="trade-roster-list">
        {roster.length === 0
          ? <div className="trade-empty-state">No contract data loaded for this team.</div>
          : roster.map(p => (
            <div key={p.id}
                 className={`trade-player-row ${selected.includes(p.id) ? "selected" : ""}`}
                 onClick={() => onToggle(p.id)}>
              <div className="trade-player-check">{selected.includes(p.id) ? "✓" : ""}</div>
              <span className="trade-player-name">{p.name}</span>
              <span className="trade-player-pos">{p.pos}</span>
              <span className="trade-player-cap">{fmtM(p.capHit)}</span>
              <span className="trade-player-yrs">{p.years}yr</span>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ---------- CAP SHEET VIEW (white / green) ----------
function fmtFull(n){ return "$" + safeNum(n).toLocaleString("en-US"); }
function lastFirst(name){
  const parts = (name||"").trim().split(/\s+/);
  if(parts.length < 2) return name || "";
  const last = parts.pop();
  return last + ", " + parts.join(" ");
}
function IcoShield({ntc}){
  return (<svg width="13" height="13" viewBox="0 0 24 24" style={{verticalAlign:"-2px"}}
    fill={ntc?"none":"#64748b"} stroke={ntc?"#aab4c2":"none"} strokeWidth="2.2" aria-hidden="true">
    <path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/></svg>);
}
function IcoCoin(){
  return (<svg width="13" height="13" viewBox="0 0 24 24" style={{verticalAlign:"-2px"}} fill="#c79a2b" aria-hidden="true">
    <path d="M8 7h8l-1 3a5 5 0 1 1-6 0z"/></svg>);
}
function IcoArb(){
  return (<svg width="13" height="13" viewBox="0 0 24 24" style={{verticalAlign:"-2px"}} fill="none" stroke="#5b6776" strokeWidth="2" aria-hidden="true">
    <path d="M7 4v16M7 4l-3 4M7 4l3 4M17 20V4M17 20l-3-4M17 20l3-4"/></svg>);
}
function IcoCap(){
  return (<svg width="14" height="14" viewBox="0 0 24 24" style={{verticalAlign:"-2px"}} fill="#5b6776" aria-hidden="true">
    <path d="M12 4L2 9l10 5 8-4v5h2V9z"/><path d="M6 12v4c0 1 3 3 6 3s6-2 6-3v-4l-6 3z"/></svg>);
}
function deriveRich(p){
  const aav = safeNum(p.aav);
  let clause = null;
  if(aav >= 7000000) clause = "NMC";
  else if(aav >= 4000000) clause = "NTC";
  const elc = aav > 0 && aav <= 1000000;
  const bonus = aav >= 6000000 || elc;
  const arb = elc || (p.type === "RFA" && aav < 4000000);
  const ir = p.category === "ir" || p.category === "ltir";
  return { clause, elc, bonus, arb, ir };
}
function deriveStatus(p, rich){ return (rich.elc || p.type === "RFA") ? "RFA" : "UFA"; }
function deriveEndIdx(p, curIdx, seasons){
  const yl = safeNum(p.years);
  let len = yl > 1 ? yl : null;
  if(!len){
    const a = safeNum(p.aav) / 1000000;
    len = Math.max(1, Math.min(8, Math.round(a / 1.6) + 1 + ((p.name||"").length % 3 - 1)));
  }
  return Math.min(seasons.length - 1, curIdx + len - 1);
}
function ExpiryPill({ kind }){
  const ufa = kind === "UFA";
  return <span style={{display:"inline-block",fontSize:12,fontWeight:600,padding:"4px 12px",borderRadius:7,
    background: ufa?"#fbe9ec":"#e7f6ee", color: ufa?"#9b2c3f":"#15803d",
    border:"1px solid "+(ufa?"#f1ccd4":"#c4e9d3")}}>{kind}</span>;
}
function CapCell({ cell }){
  if(!cell) return <td style={{padding:"9px 14px"}} />;
  if(cell.badge) return <td style={{padding:"9px 14px",textAlign:"right"}}><ExpiryPill kind={cell.badge}/></td>;
  const r = cell.rich || {};
  return (
    <td style={{padding:"9px 14px",textAlign:"right",color:"#1d2733",fontWeight:600}}>
      <span style={{display:"inline-flex",alignItems:"center",gap:5,justifyContent:"flex-end"}}>
        {r.bonus && cell.first && <IcoCoin/>}
        {r.arb && cell.first && <IcoArb/>}
        {r.clause && <IcoShield ntc={r.clause==="NTC"}/>}
        {fmtFull(cell.v)}
      </span>
    </td>
  );
}
function CapSheetGroup({ label, rows, displayIdxs }){
  if(rows.length === 0) return null;
  const totals = displayIdxs.map((_, ci) => rows.reduce((s, r) => { const c = r.cells[ci]; return s + (c && c.v ? c.v : 0); }, 0));
  return (
    <React.Fragment>
      <tr style={{background:"#f3faf6",borderTop:"1px solid #e6eaf0",borderBottom:"1px solid #e6eaf0"}}>
        <td style={{padding:"8px 14px",fontSize:11,fontWeight:700,color:"#15803d",textTransform:"uppercase",letterSpacing:"0.06em"}}>
          {label} <span style={{color:"#97a2b0",fontWeight:500}}>{rows.length}</span>
        </td>
        {totals.map((t, i) => <td key={i} style={{padding:"8px 14px",textAlign:"right",fontSize:12,fontWeight:700,color:"#15803d"}}>{t? fmtFull(t) : ""}</td>)}
      </tr>
      {rows.map((r, ri) => (
        <tr key={r.id || ri} style={{borderBottom:"1px solid #eef2f6", background: ri%2 ? "#f7faf8" : "#fff"}}>
          <td style={{padding:"9px 14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,fontWeight:600,fontSize:14}}>
              {lastFirst(r.name)}
              <span style={{display:"inline-flex",gap:5,alignItems:"center"}}>
                {r.rich.ir && <span style={{display:"inline-flex",alignItems:"center",gap:3,background:"#fdecec",color:"#c23b3b",fontSize:10,fontWeight:600,padding:"1px 5px",borderRadius:5}}>IR</span>}
                {r.rich.elc && <IcoCap/>}
                {r.rich.arb && <IcoArb/>}
              </span>
            </div>
            <div style={{fontSize:12,color:"#97a2b0",marginTop:1}}>
              <span style={{color:"#5b6776",fontWeight:600}}>age {r.age || "—"}</span> &nbsp;{r.pos}
            </div>
          </td>
          {r.cells.map((c, ci) => <CapCell key={ci} cell={c}/>)}
        </tr>
      ))}
    </React.Fragment>
  );
}
function CapSheetView({ team, data, season, capCeiling, onClose }){
  const seasons = data.meta?.seasons || [];
  const curIdx = seasons.indexOf(season);
  const displayIdxs = [];
  for(let i=0; i<6 && curIdx+i < seasons.length; i++) displayIdxs.push(curIdx+i);
  const displaySeasons = displayIdxs.map(i => seasons[i]);

  function model(p){
    const rich = deriveRich(p);
    const endIdx = deriveEndIdx(p, curIdx, seasons);
    const status = deriveStatus(p, rich);
    let firstUsed = false;
    const cells = displayIdxs.map(idx => {
      if(idx >= curIdx && idx <= endIdx){
        const first = !firstUsed; firstUsed = true;
        return { v: idx === curIdx ? p.capHit : p.aav, rich, first };
      }
      if(idx === endIdx + 1) return { badge: status };
      return null;
    });
    return { ...p, rich, status, cells };
  }
  const F=[], D=[], G=[];
  team.roster.forEach(p => {
    const m = model(p);
    if(p.pos === "D") D.push(m);
    else if(p.pos === "G") G.push(m);
    else F.push(m);
  });
  [F,D,G].forEach(g => g.sort((a,b) => safeNum(b.aav) - safeNum(a.aav)));
  const grand = displayIdxs.map((_, ci) => [...F,...D,...G].reduce((s,r)=>{const c=r.cells[ci]; return s+(c&&c.v?c.v:0);},0));

  return (
    <div style={{background:"#fff",border:"1px solid #e6eaf0",borderRadius:14,padding:"18px 18px 16px",marginTop:24,color:"#1d2733",fontFamily:"'Barlow',sans-serif"}}>
      <div style={{display:"flex",alignItems:"flex-end",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{width:10,height:10,borderRadius:"50%",background: team.color || "#16a34a",display:"inline-block"}}/>
          <span style={{fontSize:22,fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif"}}>{team.name}</span>
        </div>
        <div style={{fontSize:13,color:"#97a2b0",paddingBottom:2}}>{team.division} Division · cap sheet</div>
        <div style={{marginLeft:"auto",display:"flex",gap:18,alignItems:"center"}}>
          <div style={{textAlign:"right"}}><div style={{fontSize:17,fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{fmtM(capCeiling)}</div><div style={{fontSize:11,color:"#97a2b0",textTransform:"uppercase",letterSpacing:"0.05em"}}>Ceiling</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:17,fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{fmtM(team.payroll)}</div><div style={{fontSize:11,color:"#97a2b0",textTransform:"uppercase",letterSpacing:"0.05em"}}>Cap Hit</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:17,fontWeight:700,color: team.space<0?"#d6453f":"#16a34a",fontFamily:"'Space Mono',monospace"}}>{team.space<0?"-":"+"}{fmtM(Math.abs(team.space))}</div><div style={{fontSize:11,color:"#97a2b0",textTransform:"uppercase",letterSpacing:"0.05em"}}>Space</div></div>
          <button onClick={onClose} style={{background:"#f3f6f9",border:"1px solid #d8dee7",color:"#5b6776",cursor:"pointer",width:30,height:30,borderRadius:6,fontSize:15}}>✕</button>
        </div>
      </div>

      <div style={{height:3,background:"#16a34a",borderRadius:"3px 3px 0 0"}}/>
      <div style={{overflowX:"auto",border:"1px solid #e6eaf0",borderTop:"none",borderRadius:"0 0 12px 12px"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:760,fontVariantNumeric:"tabular-nums",background:"#fff"}}>
          <thead>
            <tr style={{borderBottom:"1px solid #e6eaf0"}}>
              <th style={{textAlign:"left",padding:"11px 14px",fontSize:11,fontWeight:600,color:"#97a2b0",textTransform:"uppercase",letterSpacing:"0.05em",minWidth:180}}>Player</th>
              {displaySeasons.map((s, i) => (
                <th key={s} style={{textAlign:"right",padding:"11px 14px",fontSize:11,fontWeight:i===0?700:600,
                  color:i===0?"#15803d":"#97a2b0",textTransform:"uppercase",letterSpacing:"0.05em",
                  borderBottom:i===0?"2px solid #16a34a":"none"}}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <CapSheetGroup label="Forwards" rows={F} displayIdxs={displayIdxs}/>
            <CapSheetGroup label="Defense" rows={D} displayIdxs={displayIdxs}/>
            <CapSheetGroup label="Goaltenders" rows={G} displayIdxs={displayIdxs}/>
          </tbody>
          <tfoot>
            <tr style={{borderTop:"2px solid #d6e6dc",background:"#f3faf6"}}>
              <td style={{padding:"11px 14px",fontSize:11,fontWeight:700,color:"#15803d",textTransform:"uppercase",letterSpacing:"0.05em"}}>Cap hit total</td>
              {grand.map((t, i) => <td key={i} style={{padding:"11px 14px",textAlign:"right",fontWeight:700}}>{t? fmtFull(t):""}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      <div style={{display:"flex",gap:16,flexWrap:"wrap",marginTop:12,fontSize:12,color:"#5b6776",alignItems:"center"}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:5}}><IcoShield/> NMC / <IcoShield ntc/> NTC clause</span>
        <span style={{display:"inline-flex",alignItems:"center",gap:5}}><IcoCoin/> Signing bonus</span>
        <span style={{display:"inline-flex",alignItems:"center",gap:5}}><IcoArb/> Arbitration</span>
        <span style={{display:"inline-flex",alignItems:"center",gap:5}}><IcoCap/> Entry-level</span>
        <span style={{marginLeft:"auto",color:"#b3bcc7",fontStyle:"italic"}}>Sample clause / bonus / term data — replaced by your spreadsheet values.</span>
      </div>
    </div>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [divFilter, setDivFilter] = useState("all");
  const [sortMode, setSortMode] = useState("space");
  const [season, setSeason] = useState("");
  const [selectedTeamAbbr, setSelectedTeamAbbr] = useState(null);

  useEffect(() => {
    fetch("data/nhl-cap-data.json", { cache: "no-store" })
      .then(r => {
        if(!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        setData(d);
        const defaultSeason = d.meta?.defaultSeason || d.meta?.seasons?.[0] || "";
        setSeason(defaultSeason);
      })
      .catch(err => setLoadError(err.message || "Failed to load data"));
  }, []);

  const seasons = data?.meta?.seasons || [];
  const divisions = data?.divisions || [];
  const capInfo = (data?.meta?.caps && season) ? (data.meta.caps[season] || {}) : {};
  const capCeiling = safeNum(capInfo.ceiling);
  const capFloor = safeNum(capInfo.floor);

  const teamData = useMemo(() => data && season ? buildTeamData(data, season, capCeiling) : [], [data, season, capCeiling]);
  const selectedTeam = useMemo(() => teamData.find(t => t.abbr === selectedTeamAbbr) || null, [teamData, selectedTeamAbbr]);

  const filtered = useMemo(() => {
    let t = teamData;
    if(divFilter !== "all") t = t.filter(x=>x.division === divFilter);
    if(search) t = t.filter(x =>
      x.name.toLowerCase().includes(search.toLowerCase()) ||
      x.abbr.toLowerCase().includes(search.toLowerCase())
    );
    if(sortMode==="space")   t = [...t].sort((a,b)=>b.space-a.space);
    if(sortMode==="payroll") t = [...t].sort((a,b)=>b.payroll-a.payroll);
    if(sortMode==="alpha")   t = [...t].sort((a,b)=>a.abbr.localeCompare(b.abbr));
    if(sortMode==="pct")     t = [...t].sort((a,b)=>(b.payroll/capCeiling)-(a.payroll/capCeiling));
    return t;
  }, [teamData, divFilter, search, sortMode, capCeiling]);

  if(loadError) {
    return (
      <div className="error-state">
        <h2>Data Load Failed</h2>
        <p>{loadError}</p>
        <p>Run this page from a local web server so the JSON can be fetched.</p>
      </div>
    );
  }

  if(!data || !season) {
    return (
      <div className="loading-state">
        <h2>Loading Cap Data</h2>
        <p>Fetching {"data/nhl-cap-data.json"}...</p>
      </div>
    );
  }

  const totalPayrolls = teamData.reduce((s,t)=>s + safeNum(t.payroll), 0);
  const overCap = teamData.filter(t=>t.space<0).length;
  const underFloor = teamData.filter(t=>t.payroll<capFloor).length;
  const populatedTeams = teamData.filter(t=>t.roster.length>0).length;

  function handleTeamClick(team) {
    setSelectedTeamAbbr(prev => prev === team.abbr ? null : team.abbr);
  }

  return (
    <div>
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <div className="logo-dot"/>
            ICE<span className="logo-ice">CAP</span>
          </div>
          <div className="season-pill">
            <span>Season</span>
            <select className="season-select" value={season} onChange={e=>setSeason(e.target.value)}>
              {seasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="data-badges">
            <div className="data-badge ice">Ceiling: {fmtM(capCeiling)}</div>
            <div className={`data-badge ${capInfo.projected ? "warn" : ""}`}>{capInfo.projected ? "Projected Cap" : "Official Cap"}</div>
            <div className="data-badge dim">Schema v{data.meta?.schemaVersion || 1}</div>
          </div>
          <div className="header-nav">
            <button className={`nav-btn ${view==="dashboard"?"active":""}`} onClick={()=>setView("dashboard")}>Dashboard</button>
            <button className={`nav-btn ${view==="standings"?"active":""}`} onClick={()=>setView("standings")}>Standings</button>
            <button className={`nav-btn ${view==="trade"?"active":""}`} onClick={()=>setView("trade")}>Trade Tool</button>
            <button className={`nav-btn ${view==="projections"?"active":""}`} onClick={()=>setView("projections")}>Projections</button>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="league-bar">
          <div className="league-stat">
            <div className="league-stat-label">Salary Cap Ceiling</div>
            <div className="league-stat-val ice">{fmtM(capCeiling)}</div>
            <div className="league-stat-sub">Cap Floor: {fmtM(capFloor)}</div>
          </div>
          <div className="league-stat">
            <div className="league-stat-label">Avg League Payroll</div>
            <div className="league-stat-val">{fmtM(totalPayrolls / (teamData.length || 1))}</div>
            <div className="league-stat-sub">{capCeiling ? ((totalPayrolls/teamData.length)/capCeiling*100).toFixed(1) : "0.0"}% of ceiling</div>
          </div>
          <div className="league-stat">
            <div className="league-stat-label">Teams Over Cap</div>
            <div className={`league-stat-val ${overCap>0?"red":""}`}>{overCap}</div>
            <div className="league-stat-sub">of {teamData.length} NHL franchises</div>
          </div>
          <div className="league-stat">
            <div className="league-stat-label">Contracts Tracked</div>
            <div className="league-stat-val green">{(data?.contracts || []).length}</div>
            <div className="league-stat-sub">across 32 franchises</div>
          </div>
        </div>

        <div className="data-note">
          <span>Data updated: {data.meta?.updated || "Unknown"}</span>
          {data.meta?.notes ? <span>• {data.meta.notes}</span> : null}
        </div>

        {data.meta?.sampleData && (
          <div className="sample-banner">
            Sample data loaded ({populatedTeams} teams populated). Add real contracts in data/nhl-cap-data.json to fill the rest.
          </div>
        )}

        {view === "dashboard" && (<>
          <div className="filters">
            <input
              className="search-input"
              placeholder="Search team..."
              value={search}
              onChange={e=>setSearch(e.target.value)}
            />
            {["all", ...divisions].map(d => (
              <button key={d} className={`filter-btn ${divFilter===d?"active":""}`}
                      onClick={()=>setDivFilter(d)}>
                {d==="all"?"All Divisions":d}
              </button>
            ))}
            <div style={{marginLeft:"auto", display:"flex", gap:6, alignItems:"center"}}>
              <span style={{fontSize:11,color:"var(--text3)",letterSpacing:"0.06em",textTransform:"uppercase",fontFamily:"'Barlow Condensed',sans-serif",fontWeight:600}}>Sort:</span>
              {[ ["space","Cap Space"], ["payroll","Payroll"], ["pct","% Used"], ["alpha","A-Z"] ].map(([v,l]) => (
                <button key={v} className={`filter-btn ${sortMode===v?"active":""}`}
                        onClick={()=>setSortMode(v)}>{l}</button>
              ))}
            </div>
          </div>

          <div className="section-header">
            <div className="section-title">All Teams <span style={{color:"var(--text3)",fontSize:13,fontWeight:400}}>({filtered.length})</span></div>
            <div className="section-line"/>
          </div>

          <div className="team-grid">
            {filtered.map(team => (
              <TeamCard
                key={team.abbr}
                team={team}
                capCeiling={capCeiling}
                selected={selectedTeam?.abbr===team.abbr}
                onClick={()=>handleTeamClick(team)}
              />
            ))}
          </div>

          {selectedTeam && (
            <CapSheetView team={selectedTeam} data={data} season={season} capCeiling={capCeiling} onClose={()=>setSelectedTeamAbbr(null)} />
          )}
        </>)}

        {view === "standings" && (<>
          <div className="section-header">
            <div className="section-title">Standings <span style={{color:"var(--text3)",fontSize:13,fontWeight:400}}>({season})</span></div>
            <div className="section-line"/>
          </div>
          <StandingsView teamData={teamData} data={data} season={season} capCeiling={capCeiling} onTeamClick={handleTeamClick} selectedTeam={selectedTeam}/>
        </>)}

        {view === "projections" && (<>
          <div className="section-header">
            <div className="section-title">Cap Projections</div>
            <div className="section-line"/>
          </div>
          <ProjectionsView teamData={teamData} data={data} capCeiling={capCeiling}/>
        </>)}

        {view === "trade" && (<>
          <div className="section-header">
            <div className="section-title">Trade Tool <span style={{color:"var(--text3)",fontSize:13,fontWeight:400}}>({season})</span></div>
            <div className="section-line"/>
          </div>
          <TradeView teamData={teamData} data={data} capCeiling={capCeiling} season={season}/>
        </>)}
      </main>
    </div>
  );
}

const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);
root.render(<App/>);
