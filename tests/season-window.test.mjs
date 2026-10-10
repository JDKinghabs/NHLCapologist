import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCapCeilings, contractSeasons, currentSeason, rollSeasonWindow, seasonAt } from "../scripts/season-window.mjs";

test("formats seasons across century boundaries", () => {
  assert.equal(seasonAt("2026-27", 1), "2027-28");
  assert.equal(seasonAt("2026-27", -2), "2024-25");
  assert.equal(seasonAt("2099-00", 0), "2099-00");
  assert.equal(seasonAt("2098-99", 1), "2099-00");
});

test("the league year rolls over on July 1", () => {
  assert.equal(currentSeason(new Date("2027-06-30T23:59:59Z")), "2026-27");
  assert.equal(currentSeason(new Date("2027-07-01T00:00:00Z")), "2027-28");
  assert.equal(currentSeason(new Date("2027-01-15T12:00:00Z")), "2026-27");
});

test("contract seasons come from the start year, even before the window", () => {
  assert.deepEqual(contractSeasons({ startSeason: "2024-25", years: 3 }), ["2024-25", "2025-26", "2026-27"]);
  assert.deepEqual(contractSeasons({ startSeason: "2026-27" }), []);
});

function sampleData() {
  const sheet = (playerId) => ({ status: "complete", items: [{ kind: "player", playerId, capHit: 1 }], adjustments: [] });
  return {
    meta: {
      seasons: ["2026-27", "2027-28"],
      defaultSeason: "2026-27",
      caps: {
        "2026-27": { ceiling: 104_000_000, floor: 76_900_000, projected: false },
        "2027-28": { ceiling: 113_500_000, floor: 83_900_000, projected: true },
      },
    },
    players: [{ id: "A" }, { id: "B" }, { id: "C" }],
    contracts: [
      { playerId: "A", startSeason: "2025-26", years: 2, capHits: { "2025-26": 1, "2026-27": 1 } },
      { playerId: "B", startSeason: "2024-25", years: 5, capHits: { "2026-27": 2, "2027-28": 2, "2028-29": 2 } },
    ],
    capSheets: { "2026-27": { TOR: sheet("A") }, "2027-28": { TOR: sheet("B") } },
    standings: { "2026-27": { TOR: { gp: 82 } } },
  };
}

test("rolling forward drops the finished season and projects the new one", () => {
  const data = sampleData();
  assert.ok(rollSeasonWindow(data, "2027-28"));

  assert.equal(data.meta.seasons[0], "2027-28");
  assert.equal(data.meta.seasons.length, 8);
  assert.equal(data.meta.defaultSeason, "2027-28");
  assert.deepEqual(data.meta.caps["2027-28"], { ceiling: 113_500_000, floor: 83_900_000, projected: true });
  assert.deepEqual(data.meta.caps["2028-29"], { ceiling: 117_000_000, floor: 86_500_000, projected: true });
  assert.equal(data.meta.caps["2034-35"].ceiling, 138_000_000);

  assert.deepEqual(Object.keys(data.capSheets), ["2027-28"]);
  assert.deepEqual(data.standings, {});
  // A's contract ended in 2026-27; B's started before the window and keeps its in-window cap hits.
  assert.deepEqual(data.contracts.map((c) => c.playerId), ["B"]);
  assert.deepEqual(data.contracts[0].capHits, { "2027-28": 2, "2028-29": 2 });
  assert.deepEqual(data.players.map((p) => p.id), ["B"]);
});

test("rolling to the season it already starts at changes nothing", () => {
  const data = sampleData();
  rollSeasonWindow(data, "2026-27");
  assert.ok(!rollSeasonWindow(data, "2026-27"));
});

test("published ceilings replace projections; later seasons project from the last one", () => {
  const data = sampleData();
  rollSeasonWindow(data, "2026-27");
  applyCapCeilings(data.meta, { "2026-27": 999, "2027-28": 113_500_000, "2028-29": 127_500_000, "2029-30": null });
  assert.equal(data.meta.caps["2026-27"].ceiling, 104_000_000);
  assert.deepEqual(data.meta.caps["2028-29"], { ceiling: 127_500_000, floor: 94_200_000, projected: true });
  assert.deepEqual(data.meta.caps["2029-30"], { ceiling: 131_000_000, floor: 96_800_000, projected: true });
  assert.equal(data.meta.caps["2033-34"].ceiling, 145_000_000);
});
