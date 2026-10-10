import React, { useState, useMemo, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { buildSeasonList, buildTeamData, safeNum, seasonAt } from "./cap-math.js";
import { parseRoute, routeHash } from "./routes.js";

// Enter or Space activates a clickable element that isn't a native button.
function onActivateKey(handler) {
  return e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); }
  };
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

function TeamCard({ team, capCeiling, selected, onClick }) {
  const pct = capCeiling ? Math.min((team.payroll / capCeiling) * 100, 105) : 0;
  const div = team.division || "—";
  const F = team.roster.filter(p=>["C","LW","RW","F"].includes(p.pos)).length;
  const D = team.roster.filter(p=>p.pos==="D").length;
  const G = team.roster.filter(p=>p.pos==="G").length;
  return (
    <div className={`team-card ${selected?"selected":""}`}
         style={{"--team-color": team.color}}
         role="button" tabIndex={0} aria-expanded={selected}
         aria-label={`${team.name}, ${team.space < 0 ? "-" : "+"}${fmt(Math.abs(team.space), true)} cap space: cap sheet`}
         onClick={onClick} onKeyDown={onActivateKey(onClick)}>
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
                tabIndex={onTeamClick ? 0 : undefined}
                onKeyDown={onTeamClick ? onActivateKey(() => onTeamClick(team)) : undefined}
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

  return (
    <div>
      <div className="filters" style={{marginBottom:16}}>
        {[["division","By Division"],["conference","By Conference"],["league","League-Wide"]].map(([v,l]) => (
          <button key={v} className={`filter-btn ${mode===v?"active":""}`} onClick={()=>setMode(v)}>{l}</button>
        ))}
      </div>
      {hasData ? (
        <div className="data-note" style={{marginBottom:12}}>
          <span>Standings as of {data.meta?.standingsAsOf || "—"} · source: NHL</span>
        </div>
      ) : (
        <div className="sample-banner">
          {season === data.meta?.seasons?.[0]
            ? `No ${season} standings yet — they appear once the season is under way.`
            : `Standings are only kept for the current season (${data.meta?.seasons?.[0]}).`}
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
        <CapSheetView team={selectedTeam} data={data} season={season} capCeiling={capCeiling} onClose={() => onTeamClick(selectedTeam)}/>
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

  // Contracts ending after each season, unless the player has already
  // signed his next contract with the same team.
  const pendingBySeason = useMemo(() => {
    const playersById = Object.fromEntries((data.players || []).map(p => [p.id, p]));
    const starts = new Set((data.contracts || []).map(c => `${c.team}|${c.playerId}|${c.startSeason}`));
    const map = {};
    (data.contracts || []).forEach(c => {
      if (starts.has(`${c.team}|${c.playerId}|${seasonAt(c.startSeason, c.years)}`)) return;
      const last = seasonAt(c.startSeason, c.years - 1);
      const p = playersById[c.playerId];
      (map[last] = map[last] || []).push({ team: c.team, name: p?.name || c.playerId, pos: p?.pos || "-", aav: c.aav, status: c.expiryStatus || null });
    });
    Object.values(map).forEach(list => list.sort((a, b) => safeNum(b.aav) - safeNum(a.aav)));
    return map;
  }, [data]);

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
          const shown = new Set(teamsToShow.map(t => t.abbr));
          const pending = (pendingBySeason[season] || []).filter(p => shown.has(p.team));
          const ufa = pending.filter(p => p.status === "UFA").length;
          const rfa = pending.filter(p => p.status === "RFA").length;
          return (
            <div key={season} className="proj-season-row">
              <div className="proj-season-header">
                <span className="proj-season-label">{season}</span>
                {capInfo.projected && <span className="proj-projected-badge">Projected</span>}
                {pending.length > 0 && (
                  <span className="proj-cap-label" title="Contracts ending after this season that have not been extended. Status at expiry comes from Spotrac.">
                    Expiring: {ufa} UFA · {rfa} RFA{pending.length > ufa + rfa ? ` · ${pending.length - ufa - rfa} status unknown` : ""}
                  </span>
                )}
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
              {teamsToShow.length === 1 && pending.length > 0 && (
                <div className="proj-expiry-row">
                  <span className="proj-expiry-label">Expiring:</span>
                  {pending.map((p, i) => (
                    <span key={i} className="proj-expiry-pill">
                      <span>{p.pos}</span>{p.name} {fmtM(p.aav)}{p.status ? ` · ${p.status}` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MAX_CONTRACTS = 50;
const MAX_RETAINED = 3;
const RETENTION_STEPS = [0, 10, 15, 20, 25, 30, 35, 40, 45, 50];

// Standard contracts and retained-salary slots in use, from the season's cap sheet.
function rosterLimits(data, season, abbr) {
  const sheet = data.capSheets?.[season]?.[abbr];
  return {
    contracts: (sheet?.items || []).filter(item => item.kind === "player").length,
    retained: (sheet?.adjustments || []).filter(adj => adj.category === "retainedSalary").length,
  };
}

function TradeView({ teamData, data, capCeiling, season }) {
  const [teamA, setTeamA] = useState("TOR");
  const [teamB, setTeamB] = useState("EDM");
  const [selectedA, setSelectedA] = useState([]);
  const [selectedB, setSelectedB] = useState([]);
  // Percent of each outgoing player's cap hit his current team keeps.
  const [retention, setRetention] = useState({});

  function getRoster(abbr) {
    return teamData.find(t => t.abbr === abbr)?.roster || [];
  }

  function togglePlayer(id, side) {
    if (side === "A") setSelectedA(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    else setSelectedB(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function resetTrade() {
    setSelectedA([]); setSelectedB([]); setRetention({});
  }

  const rosterA = getRoster(teamA);
  const rosterB = getRoster(teamB);
  const sameTeam = teamA === teamB;
  const canTrade = !sameTeam && (selectedA.length > 0 || selectedB.length > 0);
  const allTeamAbbrs = teamData.map(t => t.abbr).sort();
  const retained = (p) => Math.round(safeNum(p.capHit) * (retention[p.id] || 0) / 100);

  function evaluate(abbr, sending, receiving) {
    const team = teamData.find(t => t.abbr === abbr);
    const limits = rosterLimits(data, season, abbr);
    const delta =
      receiving.reduce((s, p) => s + safeNum(p.capHit) - retained(p), 0) -
      sending.reduce((s, p) => s + safeNum(p.capHit) - retained(p), 0);
    const newPay = safeNum(team?.payroll) + delta;
    const space = capCeiling - newPay;
    const contracts = limits.contracts - sending.length + receiving.length;
    const retainedSlots = limits.retained + sending.filter(p => retention[p.id]).length;
    const problems = [
      space < 0 && "Over the cap",
      contracts > MAX_CONTRACTS && `Over ${MAX_CONTRACTS} contracts`,
      retainedSlots > MAX_RETAINED && `Over ${MAX_RETAINED} retained contracts`,
    ].filter(Boolean);
    const status = problems.length
      ? { cls: "err", label: problems.join(" · ") }
      : space < 3000000 ? { cls: "warn", label: "Valid · tight" } : { cls: "ok", label: "Valid" };
    return { abbr, color: team?.color, prevPay: safeNum(team?.payroll), delta, newPay, space, contracts, retainedSlots, status, sending, receiving };
  }

  const sentA = rosterA.filter(p => selectedA.includes(p.id));
  const sentB = rosterB.filter(p => selectedB.includes(p.id));
  const sides = [evaluate(teamA, sentA, sentB), evaluate(teamB, sentB, sentA)];

  return (
    <div>
      <div className="trade-layout">
        <TradePanel
          side="A" abbr={teamA} roster={rosterA} selected={selectedA}
          onToggle={id => togglePlayer(id, "A")}
          onTeamChange={abbr => { setTeamA(abbr); setSelectedA([]); }}
          allAbbrs={allTeamAbbrs} teamData={teamData.find(t => t.abbr === teamA)} capCeiling={capCeiling}
        />
        <div className="trade-middle">
          <div className="trade-arrow">⇄</div>
          {sameTeam && <div className="trade-valid-badge warn" style={{textAlign:"center",padding:"8px 12px"}}>⚠ Select two<br/>different teams</div>}
          {canTrade && sides.map(t => (
            <span key={t.abbr} className={`trade-valid-badge ${t.status.cls}`} style={{textAlign:"center"}}>{t.abbr}: {t.status.label}</span>
          ))}
          <button className="trade-btn reset" onClick={resetTrade}>Reset</button>
        </div>
        <TradePanel
          side="B" abbr={teamB} roster={rosterB} selected={selectedB}
          onToggle={id => togglePlayer(id, "B")}
          onTeamChange={abbr => { setTeamB(abbr); setSelectedB([]); }}
          allAbbrs={allTeamAbbrs} teamData={teamData.find(t => t.abbr === teamB)} capCeiling={capCeiling}
        />
      </div>

      {canTrade && (
        <div className="trade-cap-summary">
          <div className="trade-summary-header">Trade Summary · {season}</div>
          <div className="trade-summary-grid">
            {sides.map(t => (
              <div key={t.abbr} className="trade-summary-team">
                <div className="trade-summary-abbr" style={{color: t.color}}>{t.abbr}</div>
                {t.sending.length > 0 && (
                  <div style={{marginBottom:10}}>
                    <div className="trade-selected-label">Sending</div>
                    {t.sending.map(p => (
                      <div key={p.id} className="trade-selected-pill">
                        <span className="trade-selected-pill-pos">{p.pos}</span>
                        <span>{p.name}</span>
                        <span className="trade-selected-pill-cap">{fmtM(p.capHit)}</span>
                        <select aria-label={`Salary ${t.abbr} retains on ${p.name}`} value={retention[p.id] || 0}
                                onChange={e => setRetention(prev => ({ ...prev, [p.id]: Number(e.target.value) }))}
                                style={{marginLeft:6,fontSize:11}}>
                          {RETENTION_STEPS.map(pct => <option key={pct} value={pct}>{pct ? `Retain ${pct}%` : "No retention"}</option>)}
                        </select>
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
                        <span className="trade-selected-pill-cap">{fmtM(safeNum(p.capHit) - retained(p))}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="trade-summary-row">
                  <span className="trade-summary-lbl">Current Payroll</span>
                  <span className="trade-summary-val">{fmtM(t.prevPay)}</span>
                </div>
                <div className="trade-summary-row">
                  <span className="trade-summary-lbl">Cap Change</span>
                  <span className={`trade-summary-val ${t.delta > 0 ? "red" : t.delta < 0 ? "green" : ""}`}>
                    {t.delta < 0 ? "-" : "+"}{fmtM(Math.abs(t.delta))}
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
                <div className="trade-summary-row">
                  <span className="trade-summary-lbl">Contracts</span>
                  <span className={`trade-summary-val ${t.contracts > MAX_CONTRACTS ? "red" : ""}`}>{t.contracts} / {MAX_CONTRACTS}</span>
                </div>
                <div className="trade-summary-row">
                  <span className="trade-summary-lbl">Retained Contracts</span>
                  <span className={`trade-summary-val ${t.retainedSlots > MAX_RETAINED ? "red" : ""}`}>{t.retainedSlots} / {MAX_RETAINED}</span>
                </div>
                <div className="trade-summary-row" style={{marginTop:8}}>
                  <span className="trade-summary-lbl">Status</span>
                  <span className={`trade-valid-badge ${t.status.cls}`}>{t.status.label}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{fontSize:11,color:"var(--text3)",padding:"0 20px 16px"}}>
            Retention is capped at 50% of a player's cap hit and 3 retained contracts per team. LTIR relief, which lets
            teams with long-term injuries exceed the ceiling, isn't modelled.
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
        <select className="trade-team-select" aria-label={`Team ${side}`} value={abbr} onChange={e => onTeamChange(e.target.value)}>
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
                 role="checkbox" aria-checked={selected.includes(p.id)} tabIndex={0}
                 onClick={() => onToggle(p.id)} onKeyDown={onActivateKey(() => onToggle(p.id))}>
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
function ExpiryPill({ kind }){
  const ufa = kind === "UFA";
  return <span style={{display:"inline-block",fontSize:12,fontWeight:600,padding:"4px 12px",borderRadius:7,
    background: ufa?"#fbe9ec":"#e7f6ee", color: ufa?"#9b2c3f":"#15803d",
    border:"1px solid "+(ufa?"#f1ccd4":"#c4e9d3")}}>{kind}</span>;
}
const CLAUSE_LABELS = {
  NMC: "No-movement clause",
  NTC: "No-trade clause",
  "M-NMC": "Modified no-movement clause",
  "M-NTC": "Modified no-trade clause",
};
const CATEGORY_CHIPS = {
  ir: { label: "IR", background: "#fdecec", color: "#c23b3b" },
  ltir: { label: "LTIR", background: "#fdecec", color: "#c23b3b" },
  minors: { label: "Minors", background: "#eef2f6", color: "#5b6776" },
  reserve: { label: "Reserve", background: "#eef2f6", color: "#5b6776" },
  nonRoster: { label: "Non-roster", background: "#eef2f6", color: "#5b6776" },
};

function bonusTitle(p){
  return [
    p.signingBonus ? `Signing bonus ${fmtFull(p.signingBonus)}` : null,
    p.incentives ? `Performance bonuses up to ${fmtFull(p.incentives)}` : null,
  ].filter(Boolean).join(" · ");
}
function CapCell({ cell }){
  if(!cell) return <td style={{padding:"9px 14px"}} />;
  if(cell.badge) return <td style={{padding:"9px 14px",textAlign:"right"}}><ExpiryPill kind={cell.badge}/></td>;
  return (
    <td style={{padding:"9px 14px",textAlign:"right",color: cell.muted ? "#b3bcc7" : "#1d2733",fontWeight:600}}
        title={cell.muted ? "Cap hit if on the NHL roster; not counted while in the minors" : undefined}>
      <span style={{display:"inline-flex",alignItems:"center",gap:5,justifyContent:"flex-end"}}>
        {cell.bonus && <span title={cell.bonus}><IcoCoin/></span>}
        {fmtFull(cell.v)}
      </span>
    </td>
  );
}
function CapSheetGroup({ label, rows, displaySeasons }){
  if(rows.length === 0) return null;
  const totals = displaySeasons.map((_, ci) => rows.reduce((s, r) => { const c = r.cells[ci]; return s + (c && c.v && !c.muted ? c.v : 0); }, 0));
  return (
    <React.Fragment>
      <tr style={{background:"#f3faf6",borderTop:"1px solid #e6eaf0",borderBottom:"1px solid #e6eaf0"}}>
        <td style={{padding:"8px 14px",fontSize:11,fontWeight:700,color:"#15803d",textTransform:"uppercase",letterSpacing:"0.06em"}}>
          {label} <span style={{color:"#6b7685",fontWeight:500}}>{rows.length}</span>
        </td>
        {totals.map((t, i) => <td key={i} style={{padding:"8px 14px",textAlign:"right",fontSize:12,fontWeight:700,color:"#15803d"}}>{t? fmtFull(t) : ""}</td>)}
      </tr>
      {rows.map((r, ri) => {
        const chip = CATEGORY_CHIPS[r.category];
        return (
          <tr key={r.id || ri} style={{borderBottom:"1px solid #eef2f6", background: ri%2 ? "#f7faf8" : "#fff"}}>
            <td style={{padding:"9px 14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,fontWeight:600,fontSize:14}}>
                {lastFirst(r.name)}
                <span style={{display:"inline-flex",gap:5,alignItems:"center"}}>
                  {r.clause && (
                    <span title={CLAUSE_LABELS[r.clause] || r.clause} style={{display:"inline-flex",alignItems:"center",gap:3,fontSize:10,fontWeight:600,color:"#5b6776"}}>
                      <IcoShield ntc={/NTC/.test(r.clause)}/>{r.clause}
                    </span>
                  )}
                  {chip && <span style={{background:chip.background,color:chip.color,fontSize:10,fontWeight:600,padding:"1px 5px",borderRadius:5}}>{chip.label}</span>}
                </span>
              </div>
              <div style={{fontSize:12,color:"#6b7685",marginTop:1}}>
                <span style={{color:"#5b6776",fontWeight:600}}>age {r.age || "—"}</span> &nbsp;{r.pos}
              </div>
            </td>
            {r.cells.map((c, ci) => <CapCell key={ci} cell={c}/>)}
          </tr>
        );
      })}
    </React.Fragment>
  );
}
function CapSheetView({ team, data, season, capCeiling, onClose }){
  const seasons = data.meta?.seasons || [];
  const sheetRef = useRef(null);
  useEffect(() => {
    sheetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [team.abbr]);
  const curIdx = seasons.indexOf(season);
  const displaySeasons = seasons.slice(curIdx, curIdx + 6);

  // Every contract each player has with this team, in order, so an extension
  // that starts after the current deal shows its own cap hits.
  const dealsByPlayer = useMemo(() => {
    const map = {};
    (data.contracts || []).filter(c => c.team === team.abbr).forEach(c => (map[c.playerId] = map[c.playerId] || []).push(c));
    Object.values(map).forEach(list => list.sort((a, b) => a.startSeason.localeCompare(b.startSeason)));
    return map;
  }, [data, team.abbr]);

  function model(p){
    const deals = dealsByPlayer[p.playerId] || [];
    const last = deals[deals.length - 1];
    const afterLast = last ? seasonAt(last.startSeason, last.years) : null;
    const bonus = bonusTitle(p);
    const cells = displaySeasons.map((s, ci) => {
      if(ci === 0) return { v: p.capHit, bonus };
      const deal = deals.find(c => buildSeasonList(c.startSeason, c.years).includes(s));
      if(deal){
        const counted = safeNum(deal.capHits?.[s]);
        return counted > 0 ? { v: counted } : { v: safeNum(deal.aav), muted: true };
      }
      if(s === afterLast && last.expiryStatus) return { badge: last.expiryStatus };
      return null;
    });
    return { ...p, cells };
  }
  const F=[], D=[], G=[];
  team.roster.forEach(p => {
    const m = model(p);
    if(p.pos === "D") D.push(m);
    else if(p.pos === "G") G.push(m);
    else F.push(m);
  });
  [F,D,G].forEach(g => g.sort((a,b) => safeNum(b.capHit) - safeNum(a.capHit)));
  const grand = displaySeasons.map((_, ci) => [...F,...D,...G].reduce((s,r)=>{const c=r.cells[ci]; return s+(c&&c.v&&!c.muted?c.v:0);},0));

  return (
    <section ref={sheetRef} className="cap-sheet" aria-label={`${team.name} cap sheet`} style={{background:"#fff",border:"1px solid #e6eaf0",borderRadius:14,padding:"18px 18px 16px",marginTop:24,color:"#1d2733",fontFamily:"'Barlow',sans-serif"}}>
      <div style={{display:"flex",alignItems:"flex-end",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{width:10,height:10,borderRadius:"50%",background: team.color || "#16a34a",display:"inline-block"}}/>
          <span style={{fontSize:22,fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif"}}>{team.name}</span>
        </div>
        <div style={{fontSize:13,color:"#6b7685",paddingBottom:2}}>{team.division} Division · cap sheet</div>
        <div style={{marginLeft:"auto",display:"flex",gap:18,alignItems:"center"}}>
          <div style={{textAlign:"right"}}><div style={{fontSize:17,fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{fmtM(capCeiling)}</div><div style={{fontSize:11,color:"#6b7685",textTransform:"uppercase",letterSpacing:"0.05em"}}>Ceiling</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:17,fontWeight:700,fontFamily:"'Space Mono',monospace"}}>{fmtM(team.payroll)}</div><div style={{fontSize:11,color:"#6b7685",textTransform:"uppercase",letterSpacing:"0.05em"}}>Cap Hit</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:17,fontWeight:700,color: team.space<0?"#d6453f":"#16a34a",fontFamily:"'Space Mono',monospace"}}>{team.space<0?"-":"+"}{fmtM(Math.abs(team.space))}</div><div style={{fontSize:11,color:"#6b7685",textTransform:"uppercase",letterSpacing:"0.05em"}}>Space</div></div>
          <button onClick={onClose} aria-label="Close cap sheet" title="Close" style={{background:"#f3f6f9",border:"1px solid #d8dee7",color:"#5b6776",cursor:"pointer",width:30,height:30,borderRadius:6,fontSize:15}}>✕</button>
        </div>
      </div>

      <div style={{height:3,background:"#16a34a",borderRadius:"3px 3px 0 0"}}/>
      <div style={{overflowX:"auto",border:"1px solid #e6eaf0",borderTop:"none",borderRadius:"0 0 12px 12px"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:760,fontVariantNumeric:"tabular-nums",background:"#fff"}}>
          <thead>
            <tr style={{borderBottom:"1px solid #e6eaf0"}}>
              <th style={{textAlign:"left",padding:"11px 14px",fontSize:11,fontWeight:600,color:"#6b7685",textTransform:"uppercase",letterSpacing:"0.05em",minWidth:180}}>Player</th>
              {displaySeasons.map((s, i) => (
                <th key={s} style={{textAlign:"right",padding:"11px 14px",fontSize:11,fontWeight:i===0?700:600,
                  color:i===0?"#15803d":"#6b7685",textTransform:"uppercase",letterSpacing:"0.05em",
                  borderBottom:i===0?"2px solid #16a34a":"none"}}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <CapSheetGroup label="Forwards" rows={F} displaySeasons={displaySeasons}/>
            <CapSheetGroup label="Defense" rows={D} displaySeasons={displaySeasons}/>
            <CapSheetGroup label="Goaltenders" rows={G} displaySeasons={displaySeasons}/>
          </tbody>
          <tfoot>
            <tr style={{borderTop:"2px solid #d6e6dc",background:"#f3faf6"}}>
              <td style={{padding:"11px 14px",fontSize:11,fontWeight:700,color:"#15803d",textTransform:"uppercase",letterSpacing:"0.05em"}}>Players' cap hits</td>
              {grand.map((t, i) => <td key={i} style={{padding:"11px 14px",textAlign:"right",fontWeight:700}}>{t? fmtFull(t):""}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      <div style={{display:"flex",gap:16,flexWrap:"wrap",marginTop:12,fontSize:12,color:"#5b6776",alignItems:"center"}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:5}}><IcoShield/> NMC / <IcoShield ntc/> NTC (M- = modified)</span>
        <span style={{display:"inline-flex",alignItems:"center",gap:5}}><IcoCoin/> Signing or performance bonus</span>
        <span><ExpiryPill kind="UFA"/> <ExpiryPill kind="RFA"/> Status when the contract ends</span>
        <span style={{color:"#b3bcc7"}}>Grey: cap hit not counted while in the minors</span>
        <span style={{marginLeft:"auto",color:"#6b7685"}}>Contract data: Spotrac</span>
      </div>
    </section>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [route, setRoute] = useState(null);
  const [search, setSearch] = useState("");
  const [divFilter, setDivFilter] = useState("all");
  const [sortMode, setSortMode] = useState("space");

  useEffect(() => {
    fetch("data/nhl-cap-data.json", { cache: "no-store" })
      .then(r => {
        if(!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(err => setLoadError(err.message || "Failed to load data"));
  }, []);

  // The URL hash is the source of truth for the season, view and open team,
  // so links can be shared and the back button works.
  useEffect(() => {
    if (!data) return;
    const ctx = {
      seasons: data.meta?.seasons || [],
      teams: (data.teams || []).map(t => t.abbr),
      defaultSeason: data.meta?.defaultSeason || data.meta?.seasons?.[0] || "",
    };
    const sync = () => setRoute(parseRoute(window.location.hash, ctx));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [data]);

  function navigate(patch) {
    const hash = routeHash({ ...route, ...patch });
    if (hash !== window.location.hash) window.location.hash = hash;
  }

  const season = route?.season || "";
  const view = route?.view || "dashboard";
  const selectedTeamAbbr = route?.team || null;
  const seasons = data?.meta?.seasons || [];
  const divisions = data?.divisions || [];
  const capInfo = (data?.meta?.caps && season) ? (data.meta.caps[season] || {}) : {};
  const capCeiling = safeNum(capInfo.ceiling);
  const capFloor = safeNum(capInfo.floor);

  const teamData = useMemo(() => data && season ? buildTeamData(data, season, capCeiling) : [], [data, season, capCeiling]);
  const selectedTeam = useMemo(() => teamData.find(t => t.abbr === selectedTeamAbbr) || null, [teamData, selectedTeamAbbr]);

  useEffect(() => {
    if (!route) return;
    const label = selectedTeam ? `${selectedTeam.name} cap sheet`
      : { dashboard: "NHL Salary Cap Tracker", standings: "Standings and payrolls", trade: "Trade tool", projections: "Cap projections" }[view];
    document.title = `${label} · ${season} · IceCap`;
  }, [route, selectedTeam, view, season]);

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
        <p>The cap data couldn't be loaded ({loadError}). Please reload the page.</p>
      </div>
    );
  }

  if(!data || !route) {
    return (
      <div className="loading-state">
        <h2>Loading Cap Data</h2>
        <p>Fetching {"data/nhl-cap-data.json"}...</p>
      </div>
    );
  }

  const totalPayrolls = teamData.reduce((s,t)=>s + safeNum(t.payroll), 0);
  const overCap = teamData.filter(t=>t.space<0).length;

  function handleTeamClick(team) {
    navigate({ team: selectedTeamAbbr === team.abbr ? null : team.abbr });
  }

  return (
    <div>
      <header className="header">
        <div className="header-inner">
          <a className="logo" href="#/" aria-label="IceCap home">
            <div className="logo-dot"/>
            ICE<span className="logo-ice">CAP</span>
          </a>
          <label className="season-pill">
            <span>Season</span>
            <select className="season-select" value={season} onChange={e=>navigate({ season: e.target.value })}>
              {seasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="data-badges">
            <div className="data-badge ice">Ceiling: {fmtM(capCeiling)}</div>
            <div className={`data-badge ${capInfo.projected ? "warn" : ""}`}>{capInfo.projected ? "Projected Cap" : "Official Cap"}</div>
          </div>
          <nav className="header-nav" aria-label="Sections">
            {[["dashboard","Dashboard"],["standings","Standings"],["trade","Trade",<span className="nav-extra"> Tool</span>],["projections","Projections"]].map(([v, l, extra]) => (
              <button key={v} className={`nav-btn ${view===v?"active":""}`} aria-current={view===v ? "page" : undefined}
                      onClick={()=>navigate({ view: v, team: null })}>{l}{extra}</button>
            ))}
          </nav>
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

        {view === "dashboard" && (<>
          <div className="filters">
            <input
              className="search-input"
              aria-label="Search teams"
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
            <CapSheetView team={selectedTeam} data={data} season={season} capCeiling={capCeiling} onClose={()=>navigate({ team: null })} />
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

      <footer className="site-footer">
        <p>
          Contracts and cap figures from <a href="https://www.spotrac.com/nhl/cap/" target="_blank" rel="noopener noreferrer">Spotrac</a>,
          refreshed daily (last update {data.meta?.updated || "unknown"}).
          Standings and team names from the <a href="https://www.nhl.com/standings" target="_blank" rel="noopener noreferrer">NHL</a>
          {data.meta?.standingsAsOf ? ` (as of ${data.meta.standingsAsOf})` : ""}.
          Cap ceilings after {seasons[0]} are projections.
        </p>
        <p>IceCap is an independent fan site, not affiliated with the NHL, its teams or Spotrac.</p>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App/>);
