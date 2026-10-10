import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHash } from "../src/routes.js";

const ctx = { seasons: ["2026-27", "2027-28"], teams: ["TOR", "EDM"], defaultSeason: "2026-27" };

test("an empty hash opens the default season's dashboard", () => {
  assert.deepEqual(parseRoute("", ctx), { season: "2026-27", view: "dashboard", team: null });
  assert.deepEqual(parseRoute("#/", ctx), { season: "2026-27", view: "dashboard", team: null });
});

test("reads the season, view and team, in any case", () => {
  assert.deepEqual(parseRoute("#/2027-28/standings/tor", ctx), { season: "2027-28", view: "standings", team: "TOR" });
  assert.deepEqual(parseRoute("#/EDM", ctx), { season: "2026-27", view: "dashboard", team: "EDM" });
});

test("unknown parts fall back to the defaults", () => {
  assert.deepEqual(parseRoute("#/2019-20/nonsense/XYZ", ctx), { season: "2026-27", view: "dashboard", team: null });
  assert.deepEqual(parseRoute("#/%E0%A4%A", ctx), { season: "2026-27", view: "dashboard", team: null });
});

test("views without a cap sheet drop the team", () => {
  assert.deepEqual(parseRoute("#/2026-27/trade/TOR", ctx), { season: "2026-27", view: "trade", team: null });
  assert.equal(routeHash({ season: "2026-27", view: "projections", team: "TOR" }), "#/2026-27/projections");
});

test("a built hash parses back to the same route", () => {
  const route = { season: "2027-28", view: "dashboard", team: "EDM" };
  assert.equal(routeHash(route), "#/2027-28/dashboard/EDM");
  assert.deepEqual(parseRoute(routeHash(route), ctx), route);
});
