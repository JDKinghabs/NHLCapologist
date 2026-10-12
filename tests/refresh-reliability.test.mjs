import { test } from "node:test";
import assert from "node:assert/strict";

// Keep retry backoff short; refresh-data.js reads this when it loads.
process.env.REQUEST_DELAY_MS = "1";
const { fetchUrl, retryFailedPages, updateStaleTeams } = await import("../scripts/refresh-data.js");

const URL_CGY = "https://www.spotrac.com/nhl/calgary-flames/cap/_/year/2026";
const page = (length) => ({ ok: true, status: 200, text: async () => "x".repeat(length) });

test("fetchUrl retries a failed request instead of crashing", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls < 3) throw new Error("socket hang up");
    return page(6000);
  });
  t.mock.method(console, "warn", () => {});
  const html = await fetchUrl(URL_CGY);
  assert.equal(calls, 3);
  assert.equal(html.length, 6000);
});

test("fetchUrl gives up after its retries with the last error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 503, text: async () => "" }));
  t.mock.method(console, "warn", () => {});
  await assert.rejects(fetchUrl(URL_CGY), /fetch failed after 3 attempts: HTTP 503/);
});

test("a failed page gets a second try at the end of the run", async (t) => {
  t.mock.method(console, "log", () => {});
  const tried = [];
  const failed = [{ abbr: "CGY", label: "2026-27" }, { abbr: "DAL", label: "multi-year" }];
  const still = await retryFailedPages(failed, async (entry) => {
    tried.push(entry.abbr);
    if (entry.abbr === "DAL") throw new Error("still broken");
  }, 0);
  assert.deepEqual(tried, ["CGY", "DAL"]);
  assert.equal(still.length, 1);
  assert.equal(still[0].abbr, "DAL");
  assert.equal(still[0].error.message, "still broken");
});

test("with nothing failed there is no second pass", async () => {
  assert.deepEqual(await retryFailedPages([], () => { throw new Error("not called"); }, 0), []);
});

test("staleTeams keeps the first failing day and clears when the team recovers", () => {
  const meta = {};
  const cgyFails = () => new Map([["CGY", new Set(["2026-27"])]]);
  updateStaleTeams(meta, ["CGY", "TOR"], cgyFails(), "2026-10-11");
  assert.deepEqual(meta.staleTeams, { CGY: { since: "2026-10-11", pages: ["2026-27"] } });

  // Still failing the next day: unchanged, so a quiet day makes no commit.
  const before = JSON.stringify(meta);
  updateStaleTeams(meta, ["CGY", "TOR"], cgyFails(), "2026-10-12");
  assert.equal(JSON.stringify(meta), before);

  // A single-team run for TOR leaves CGY alone.
  updateStaleTeams(meta, ["TOR"], new Map(), "2026-10-12");
  assert.ok(meta.staleTeams.CGY);

  // Recovery removes the entry, and the key goes away when nothing is stale.
  updateStaleTeams(meta, ["CGY", "TOR"], new Map(), "2026-10-13");
  assert.equal(meta.staleTeams, undefined);
});
