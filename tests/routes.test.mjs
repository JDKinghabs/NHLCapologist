import { test } from "node:test";
import assert from "node:assert/strict";
import { pageTitle, parseRoute, routePath } from "../src/routes.js";

const ctx = { seasons: ["2026-27", "2027-28"], teams: ["TOR", "EDM"], defaultSeason: "2026-27" };

test("the root opens the current season's dashboard", () => {
  assert.deepEqual(parseRoute("/", ctx), { season: "2026-27", view: "dashboard", team: null });
  assert.deepEqual(parseRoute("", ctx), { season: "2026-27", view: "dashboard", team: null });
});

test("reads team pages, views and other seasons, in any case", () => {
  assert.deepEqual(parseRoute("/teams/TOR", ctx), { season: "2026-27", view: "dashboard", team: "TOR" });
  assert.deepEqual(parseRoute("/2027-28/standings/tor", ctx), { season: "2027-28", view: "standings", team: "TOR" });
  assert.deepEqual(parseRoute("/Projections", ctx), { season: "2026-27", view: "projections", team: null });
});

test("old hash links read the same way", () => {
  assert.deepEqual(parseRoute("#/2027-28/dashboard/EDM", ctx), { season: "2027-28", view: "dashboard", team: "EDM" });
  assert.equal(routePath(parseRoute("#/2026-27/dashboard/TOR", ctx), ctx.defaultSeason), "/teams/TOR");
});

test("unknown parts fall back to the defaults", () => {
  assert.deepEqual(parseRoute("/2019-20/nonsense/XYZ", ctx), { season: "2026-27", view: "dashboard", team: null });
  assert.deepEqual(parseRoute("/%E0%A4%A", ctx), { season: "2026-27", view: "dashboard", team: null });
});

test("paths leave out the current season and drop teams on views without a cap sheet", () => {
  assert.equal(routePath({ season: "2026-27", view: "dashboard", team: null }, "2026-27"), "/");
  assert.equal(routePath({ season: "2026-27", view: "dashboard", team: "TOR" }, "2026-27"), "/teams/TOR");
  assert.equal(routePath({ season: "2027-28", view: "dashboard", team: null }, "2026-27"), "/2027-28");
  assert.equal(routePath({ season: "2027-28", view: "standings", team: "EDM" }, "2026-27"), "/2027-28/standings/EDM");
  assert.equal(routePath({ season: "2026-27", view: "trade", team: "TOR" }, "2026-27"), "/trade");
});

test("a built path parses back to the same route", () => {
  for (const route of [
    { season: "2027-28", view: "dashboard", team: "EDM" },
    { season: "2026-27", view: "standings", team: "TOR" },
    { season: "2026-27", view: "projections", team: null },
  ]) {
    assert.deepEqual(parseRoute(routePath(route, ctx.defaultSeason), ctx), route);
  }
});

test("page titles name the team or the view, and the season", () => {
  assert.equal(pageTitle({ season: "2026-27", view: "dashboard" }, "Toronto Maple Leafs"), "Toronto Maple Leafs Salary Cap 2026-27 · IceCap");
  assert.equal(pageTitle({ season: "2027-28", view: "trade" }), "NHL Trade Cap Checker 2027-28 · IceCap");
});
