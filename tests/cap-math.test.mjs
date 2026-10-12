import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTeamData, ltirRelief } from "../src/cap-math.js";

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
