import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTeamData, ltirRelief, teamSeasonTotals } from "../src/cap-math.js";

const M = 1_000_000;

test("a team under the ceiling needs no LTIR relief", () => {
  assert.deepEqual(ltirRelief({ payroll: 100 * M, ceiling: 104 * M, ltirCapHit: 3 * M }),
    { ltirCapHit: 3 * M, ltirPool: 0, spaceWithLtir: 4 * M, capStatus: "under" });
});

test("exactly at the ceiling is under it", () => {
  const r = ltirRelief({ payroll: 104 * M, ceiling: 104 * M, ltirCapHit: 0 });
  assert.equal(r.capStatus, "under");
  assert.equal(r.spaceWithLtir, 0);
});

test("over the ceiling but covered by LTIR uses exactly the relief it needs", () => {
  // Toronto, Oct 2026: $109.92M payroll, $12.25M on LTIR, $104M ceiling.
  const r = ltirRelief({ payroll: 109_917_882, ceiling: 104 * M, ltirCapHit: 12_250_000 });
  assert.equal(r.capStatus, "ltir");
  assert.equal(r.ltirPool, 5_917_882);
  assert.equal(r.spaceWithLtir, 0);
});

test("over the ceiling even after LTIR relief", () => {
  const r = ltirRelief({ payroll: 112.82 * M, ceiling: 104 * M, ltirCapHit: 8.8 * M });
  assert.equal(r.capStatus, "over");
  assert.equal(r.ltirPool, 8.8 * M);
  assert.ok(r.spaceWithLtir < 0);
});

test("over the ceiling with no LTIR players is over", () => {
  const r = ltirRelief({ payroll: 104.43 * M, ceiling: 104 * M, ltirCapHit: 0 });
  assert.equal(r.capStatus, "over");
  assert.equal(r.ltirPool, 0);
  assert.equal(Math.round(r.spaceWithLtir), Math.round(-0.43 * M));
});

test("no ceiling known means no space and no relief", () => {
  assert.deepEqual(ltirRelief({ payroll: 90 * M, ceiling: 0, ltirCapHit: 5 * M }),
    { ltirCapHit: 5 * M, ltirPool: 0, spaceWithLtir: 0, capStatus: "under" });
});

test("buildTeamData counts LTIR players in the current season only", () => {
  const data = {
    meta: { defaultSeason: "2026-27", seasons: ["2026-27", "2027-28"] },
    teams: [{ abbr: "TOR", name: "Toronto" }],
    players: [{ id: "a", name: "A", pos: "C" }, { id: "b", name: "B", pos: "D" }],
    contracts: [
      { playerId: "a", team: "TOR", startSeason: "2026-27", years: 2, aav: 100 * M },
      { playerId: "b", team: "TOR", startSeason: "2026-27", years: 2, aav: 8 * M },
    ],
    capSheets: {
      "2026-27": { TOR: { items: [
        { kind: "player", playerId: "a", capHit: 100 * M, category: "active" },
        { kind: "player", playerId: "b", capHit: 8 * M, category: "ltir" },
      ] } },
    },
  };
  const [now] = buildTeamData(data, "2026-27", 104 * M);
  assert.equal(now.payroll, 108 * M);
  assert.equal(now.space, -4 * M);
  assert.equal(now.ltirCapHit, 8 * M);
  assert.equal(now.capStatus, "ltir");
  assert.equal(now.spaceWithLtir, 0);

  const [next] = buildTeamData(data, "2027-28", 113.5 * M);
  assert.equal(next.ltirCapHit, 0);
  assert.equal(next.capStatus, "under");
  assert.equal(next.spaceWithLtir, next.space);
});

test("teamSeasonTotals rolls a team's totals by season", () => {
  const data = {
    meta: {
      defaultSeason: "2026-27",
      seasons: ["2026-27", "2027-28"],
      caps: { "2026-27": { ceiling: 104 * M }, "2027-28": { ceiling: 113.5 * M, projected: true } },
    },
    teams: [{ abbr: "TOR", name: "Toronto" }],
    players: [
      { id: "a", name: "A", pos: "C" }, { id: "b", name: "B", pos: "D" },
      { id: "e", name: "E", pos: "LW" }, { id: "g", name: "G", pos: "G" },
    ],
    contracts: [
      { playerId: "a", team: "TOR", startSeason: "2026-27", years: 2, aav: 60 * M, expiryStatus: "UFA" },
      { playerId: "b", team: "TOR", startSeason: "2026-27", years: 1, aav: 40 * M, expiryStatus: "RFA" },
      // E's deal ends after 2026-27 but he has already re-signed: not a pending free agent.
      { playerId: "e", team: "TOR", startSeason: "2026-27", years: 1, aav: 5 * M, expiryStatus: "UFA" },
      { playerId: "e", team: "TOR", startSeason: "2027-28", years: 1, aav: 6 * M, expiryStatus: "UFA" },
      { playerId: "g", team: "TOR", startSeason: "2026-27", years: 1, aav: 2 * M, expiryStatus: "UFA" },
    ],
    capSheets: {
      "2026-27": { TOR: {
        items: [
          { kind: "player", playerId: "a", capHit: 60 * M, category: "active" },
          { kind: "player", playerId: "b", capHit: 40 * M, category: "ltir" },
          { kind: "player", playerId: "e", capHit: 5 * M, category: "active" },
          { kind: "player", playerId: "g", capHit: 2 * M, category: "active" },
        ],
        adjustments: [{ category: "buyout", amount: 1 * M }],
      } },
      "2027-28": { TOR: { items: [
        { kind: "player", playerId: "a", capHit: 60 * M, category: "active" },
        { kind: "player", playerId: "e", capHit: 6 * M, category: "active" },
      ] } },
    },
  };
  const [now, next] = teamSeasonTotals(data, "TOR", ["2026-27", "2027-28"]);

  assert.equal(now.payroll, 108 * M);
  assert.equal(now.deadCap, 1 * M);
  assert.equal(now.capStatus, "ltir"); // $4M over, covered by B's $40M on LTIR
  assert.equal(now.space, 0);
  assert.deepEqual([now.signed, now.forwards, now.defense, now.goalies], [4, 2, 1, 1]);
  assert.deepEqual([now.ufa, now.rfa], [1, 1]); // G (UFA) and B (RFA); E has re-signed

  assert.equal(next.projected, true);
  assert.equal(next.payroll, 66 * M);
  assert.equal(next.space, 47.5 * M);
  assert.equal(next.capStatus, "under");
  assert.deepEqual([next.signed, next.forwards, next.defense, next.goalies], [2, 2, 0, 0]);
  assert.deepEqual([next.ufa, next.rfa], [2, 0]); // A and E end after 2027-28
});
