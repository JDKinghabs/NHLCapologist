import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStandings, seasonId } from "../scripts/refresh-standings.mjs";

// Rows in the shape of api-web.nhle.com/v1/standings/now (fields the script reads).
const row = (abbr, name, gp, w, l, ot, season = 20262027, date = "2026-10-10") => ({
  seasonId: season,
  date,
  teamAbbrev: { default: abbr },
  teamName: { default: name },
  gamesPlayed: gp,
  wins: w,
  losses: l,
  otLosses: ot,
  points: w * 2 + ot,
});

test("maps a season to the API's season id", () => {
  assert.equal(seasonId("2026-27"), 20262027);
  assert.equal(seasonId("2099-00"), 20992100);
});

test("reads the current season's records and official team names", () => {
  const parsed = parseStandings(
    { standings: [row("TOR", "Toronto Maple Leafs", 3, 2, 1, 0), row("UTA", "Utah Mammoth", 3, 1, 1, 1, 20262027, "2026-10-09")] },
    "2026-27"
  );
  assert.deepEqual(parsed.standings, { TOR: { gp: 3, w: 2, l: 1, ot: 0 }, UTA: { gp: 3, w: 1, l: 1, ot: 1 } });
  assert.deepEqual(parsed.names, { TOR: "Toronto Maple Leafs", UTA: "Utah Mammoth" });
  assert.equal(parsed.asOf, "2026-10-10");
});

test("before the season starts, last season's standings are skipped", () => {
  assert.equal(parseStandings({ standings: [row("TOR", "Toronto Maple Leafs", 82, 50, 25, 7, 20252026)] }, "2026-27"), null);
});

test("an unexpected response shape fails loudly", () => {
  assert.throws(() => parseStandings({}, "2026-27"), /no standings rows/);
  assert.throws(() => parseStandings({ standings: [{ seasonId: 20262027, teamAbbrev: { default: "TOR" } }] }, "2026-27"), /Unexpected NHL standings row/);
});
