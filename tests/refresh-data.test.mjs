import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";

const {
  buildFutureSheets,
  capTotalsCharges,
  checkAgainstSpotracTotals,
  classifySection,
  dropImpossibleCapHits,
  parseTeamPage,
  parseYearlyPage,
  rebuildPlayersAndContracts,
  sameCapSheet,
} = await import("../scripts/refresh-data.js");

const page = fs.readFileSync(new URL("./fixtures/spotrac-team-page.html", import.meta.url), "utf8");
const byName = (rows, name) => rows.find((row) => row.name === name);

test("classifies every section title Spotrac uses", () => {
  assert.deepEqual(
    [
      "Active Roster Cap",
      "Injured List Cap",
      "Long-Term Injured Reserve Cap",
      "Reserve/Suspended Cap",
      "Buyout Cap",
      "Retained Cap",
      "Minor",
      "Cap Totals",
      "Something New",
    ].map(classifySection),
    ["active", "ir", "ltir", "reserve", "buyout", "retained", "minors", "totals", null]
  );
});

test("parses each table's rows by column header", () => {
  const parsed = parseTeamPage({ abbr: "NYI" }, page, "2026-27");
  assert.deepEqual(
    parsed.sections.map(({ title, kind, count }) => [title, kind, count]),
    [
      ["Active Roster Cap", "active", 3],
      ["Injured List Cap", "ir", 1],
      ["Buyout Cap", "buyout", 1],
      ["Minor", "minors", 2],
    ]
  );

  const schaefer = byName(parsed.active, "Matthew Schaefer");
  assert.equal(schaefer.spotracId, "99321");
  assert.equal(schaefer.pos, "D");
  assert.equal(schaefer.adjustedCap, 986250);
  assert.equal(schaefer.baseSalary, 877500);
  assert.equal(schaefer.signingBonus, 97500);
  assert.equal(schaefer.incentives, 3500000);
  assert.equal(schaefer.clause, null);

  assert.equal(byName(parsed.active, "Bo Horvat").clause, "NTC");
  assert.equal(byName(parsed.active, "Ilya Sorokin").clause, "NMC");
  assert.equal(byName(parsed.ir, "Mathew Barzal").clause, "M-NTC");
  assert.equal(byName(parsed.buyout, "Rick DiPietro").adjustedCap, 0);
});

test("reads the Minor table, which has no data-sort attributes, from cell text", () => {
  const { minors } = parseTeamPage({ abbr: "NYI" }, page, "2026-27");
  const engvall = byName(minors, "Pierre Engvall");
  assert.deepEqual(
    [engvall.pos, engvall.totalCap, engvall.adjustedCap, engvall.buried, engvall.clause],
    ["LW", 3000000, 1775000, true, "M-NTC"]
  );
  assert.equal(byName(minors, "Vladimir Dravecky").incentives, 72500);
});

test("reads Spotrac's cap totals", () => {
  const { totals } = parseTeamPage({ abbr: "NYI" }, page, "2026-27");
  assert.equal(totals["Salary Cap Maximum"], "$104,000,000");
  assert.equal(totals["Total Allocations"], "$29,668,750");
});

test("accepts a page whose tables add up to Spotrac's total", () => {
  const parsed = parseTeamPage({ abbr: "NYI" }, page, "2026-27");
  assert.doesNotThrow(() => checkAgainstSpotracTotals(parsed, []));
});

test("refuses a page whose tables don't add up", () => {
  const parsed = parseTeamPage({ abbr: "NYI" }, page, "2026-27");
  parsed.active.pop();
  assert.throws(() => checkAgainstSpotracTotals(parsed, []), /Spotrac reports \$29,668,750/);
});

test("refuses a table with columns it doesn't recognize", () => {
  const renamed = page.replaceAll('id="position1_abbreviation"', 'id="pos"');
  assert.throws(() => parseTeamPage({ abbr: "NYI" }, renamed, "2026-27"), /Unrecognized table columns/);
});

test("skips cap hits above the max salary and still reconciles", () => {
  const bogus = page
    .replace('data-sort="986250"> <span class=" "> $986,250 </span> </td> <td class="dt-ordering-desc', 'data-sort="157608247"> <span class=" "> $157,608,247 </span> </td> <td class="dt-ordering-desc')
    .replace('data-sort="986250"> <span class=" "> $986,250 </span>', 'data-sort="157608247"> <span class=" "> $157,608,247 </span>')
    .replace("$29,668,750", "$186,290,747");
  const parsed = parseTeamPage({ abbr: "NYI" }, bogus, "2026-27");
  const dropped = dropImpossibleCapHits(parsed, 20_800_000, "NYI");
  assert.deepEqual(dropped.map((row) => row.name), ["Matthew Schaefer"]);
  assert.doesNotThrow(() => checkAgainstSpotracTotals(parsed, dropped));
});

test("turns Cap Totals-only charges into adjustments", () => {
  const charges = capTotalsCharges({
    "Salary Cap Maximum": "$104,000,000",
    Adjustment: "$-918,694",
    "Performance Bonus Cushion Charge": "$6,430,000",
    "Potential Bonuses": "$14,230,000",
    "Total Allocations": "$100,558,207",
  });
  assert.deepEqual(charges, [
    { label: "Salary cap maximum adjustment", category: "other", amount: 918694 },
    { label: "Performance Bonus Cushion Charge", category: "bonusOverage", amount: 6430000 },
  ]);
});

test("ignores the import date when comparing cap sheets", () => {
  const sheet = (date) => ({ status: "complete", items: [{ playerId: "SR_1", capHit: 1 }], notes: [`Imported from Spotrac 2026-27 cap table on ${date}.`, "Sections: x."] });
  assert.ok(sameCapSheet(sheet("2026-10-09"), sheet("2026-10-10")));
  assert.ok(!sameCapSheet(sheet("2026-10-09"), { ...sheet("2026-10-09"), items: [] }));
});

const yearly = fs.readFileSync(new URL("./fixtures/spotrac-yearly-page.html", import.meta.url), "utf8");
const team = { abbr: "TOR", slug: "toronto-maple-leafs" };
const FUTURE = ["2027-28", "2028-29", "2029-30", "2030-31"];
const noLimit = () => Infinity;

test("parses the multi-year page's roster tables, badges, clauses and ages", () => {
  const page = parseYearlyPage(yearly);
  assert.deepEqual(
    page.rows.map((row) => [row.name, row.kind]),
    [
      ["Auston Matthews", "active"],
      ["William Nylander", "active"],
      ["Macklin Celebrini", "active"],
      ["Elvis Merzlikins", "ltir"],
      ["Martin Jones", "buyout"],
      ["Tomas Hertl", "retained"],
      ["Miles Wood", "minors"],
      ["Tinus-Luc Koblar", "minors"],
    ]
  );
  const matthews = page.rows[0];
  assert.deepEqual(matthews.capHits, { "2026-27": 13250000, "2027-28": 13250000 });
  assert.deepEqual(matthews.expiries, [{ season: "2028-29", status: "UFA" }]);
  assert.deepEqual(matthews.clauses, { "2026-27": "NMC", "2027-28": "NMC" });
  assert.deepEqual([matthews.pos, matthews.age], ["C", 29]);
  // Badge cells carry small sort codes (5, 4) that must not read as cap hits.
  assert.deepEqual(page.rows[1].expiries, []);
  assert.deepEqual(page.rows[7].capHits, { "2026-27": 1028333, "2027-28": 1028333, "2028-29": 1028333 });
  assert.deepEqual(page.rows[7].expiries, [{ season: "2029-30", status: "RFA" }]);
  assert.deepEqual(page.summary["Total Cap"], { "2026-27": 33204167, "2027-28": 46287500, "2028-29": 33037500, "2029-30": 31687500 });
  assert.deepEqual(page.summary["Cap Maximum"], { "2026-27": 104000000, "2027-28": 113500000, "2028-29": 127500000, "2029-30": null });
});

test("refuses a multi-year page without its tables", () => {
  assert.throws(() => parseYearlyPage("<html><table class='table'></table></html>"), /no Active Roster or Summary/);
});

test("builds future sheets that add up to Spotrac's total cap", () => {
  const sheets = buildFutureSheets(team, parseYearlyPage(yearly), FUTURE, noLimit);
  const s2728 = sheets["2027-28"];
  assert.deepEqual(
    s2728.items.map((item) => [item.playerId, item.category, item.capHit, item.aav, item.clause]),
    [
      ["SR_20276", "active", 13250000, undefined, "NMC"],
      ["SR_15746", "active", 11500000, undefined, "NTC"],
      ["SR_94103", "active", 18800000, undefined, undefined],
      ["SR_18927", "minors", 0, 2500000, undefined],
      ["SR_99413", "minors", 0, 1028333, undefined],
    ]
  );
  assert.deepEqual(
    s2728.adjustments.map((adj) => [adj.category, adj.label, adj.amount]),
    [
      ["retainedSalary", "Tomas Hertl", 1387500],
      ["buried", "Buried contracts and other charges", 1350000],
    ]
  );
  const total = (sheet) => sheet.items.reduce((s, i) => s + i.capHit, 0) + sheet.adjustments.reduce((s, a) => s + a.amount, 0);
  assert.equal(total(s2728), 46287500);
  assert.equal(total(sheets["2028-29"]), 33037500);
  assert.equal(total(sheets["2029-30"]), 31687500);
  assert.equal(sheets["2029-30"].adjustments.some((adj) => adj.category === "buried"), false);
  assert.deepEqual(sheets["2030-31"].items, []);
});

test("fails a multi-year page whose rows exceed Spotrac's total", () => {
  const short = yearly.replace("$46,287,500", "$40,000,000");
  assert.throws(() => buildFutureSheets(team, parseYearlyPage(short), FUTURE, noLimit), /2027-28: itemized/);
});

test("skips impossible future cap hits without counting them as other charges", () => {
  const sheets = buildFutureSheets(team, parseYearlyPage(yearly), FUTURE, () => 12_000_000);
  assert.ok(!sheets["2027-28"].items.some((item) => item.playerId === "SR_20276"));
  assert.equal(sheets["2027-28"].adjustments.find((adj) => adj.category === "buried").amount, 1350000);
});

test("rebuilds contracts from every season's sheets", () => {
  const page = parseYearlyPage(yearly);
  const future = buildFutureSheets(team, page, FUTURE, noLimit);
  const current = {
    status: "complete",
    adjustments: [],
    items: [
      { kind: "player", playerId: "SR_20276", category: "active", capHit: 13250000, clause: "NMC" },
      { kind: "player", playerId: "SR_15746", category: "active", capHit: 11500000 },
      { kind: "player", playerId: "SR_28788", category: "ltir", capHit: 5400000 },
      { kind: "player", playerId: "SR_18927", category: "minors", capHit: 1350000, aav: 2500000 },
      { kind: "player", playerId: "SR_99413", category: "minors", capHit: 0, aav: 1028333 },
    ],
  };
  const data = {
    meta: { seasons: ["2026-27", ...FUTURE] },
    capSheets: { "2026-27": { TOR: current }, ...Object.fromEntries(FUTURE.map((s) => [s, { TOR: future[s] }])) },
    players: [{ id: "SR_20276", name: "Auston Matthews", pos: "C", age: 0 }, { id: "TOR_34", name: "Gone", pos: "C", age: 0 }],
  };
  const info = new Map(page.rows.map((row) => [`SR_${row.spotracId}`, { name: row.name, pos: row.pos, age: row.age }]));
  const expiries = new Map(page.rows.filter((row) => row.expiries.length).map((row) => [`TOR|SR_${row.spotracId}`, row.expiries]));
  rebuildPlayersAndContracts(data, info, expiries);

  const byPlayer = Object.fromEntries(data.contracts.map((c) => [c.playerId, c]));
  assert.deepEqual(
    [byPlayer.SR_20276.startSeason, byPlayer.SR_20276.years, byPlayer.SR_20276.aav, byPlayer.SR_20276.expiryStatus, byPlayer.SR_20276.clause],
    ["2026-27", 2, 13250000, "UFA", "NMC"]
  );
  assert.deepEqual([byPlayer.SR_15746.years, byPlayer.SR_15746.expiryStatus], [4, undefined]);
  assert.deepEqual([byPlayer.SR_28788.years, byPlayer.SR_28788.expiryStatus], [1, "UFA"]);
  assert.deepEqual(byPlayer.SR_18927.capHits, { "2026-27": 1350000, "2027-28": 0, "2028-29": 0 });
  assert.deepEqual([byPlayer.SR_18927.aav, byPlayer.SR_18927.expiryStatus], [2500000, "UFA"]);
  assert.deepEqual([byPlayer.SR_99413.years, byPlayer.SR_99413.expiryStatus], [3, "RFA"]);
  // Players come from the contracts: ages from the multi-year page, stale records dropped.
  assert.deepEqual(data.players.find((p) => p.id === "SR_20276"), { id: "SR_20276", name: "Auston Matthews", pos: "C", age: 29 });
  assert.ok(!data.players.some((p) => p.id === "TOR_34"));
});

test("a new cap hit for the same player starts a new contract", () => {
  const sheet = (capHit) => ({ TOR: { items: [{ kind: "player", playerId: "SR_1", capHit }], adjustments: [] } });
  const data = { meta: { seasons: ["2026-27", "2027-28", "2028-29"] }, capSheets: { "2026-27": sheet(1e6), "2027-28": sheet(5e6), "2028-29": sheet(5e6) }, players: [] };
  rebuildPlayersAndContracts(data, new Map(), new Map());
  assert.deepEqual(data.contracts.map((c) => [c.startSeason, c.years, c.aav]), [["2026-27", 1, 1e6], ["2027-28", 2, 5e6]]);
});

test("a player another team retains salary on counts for his reduced cap hit", () => {
  const retention = new Map([["SR_20276", 3_250_000]]);
  const sheets = buildFutureSheets(team, parseYearlyPage(yearly.replace("$46,287,500", "$43,037,500")), FUTURE, noLimit, retention);
  const matthews = sheets["2027-28"].items.find((item) => item.playerId === "SR_20276");
  assert.deepEqual([matthews.capHit, matthews.aav], [10_000_000, 13_250_000]);
  assert.equal(sheets["2027-28"].adjustments.find((adj) => adj.category === "buried").amount, 1350000);
});

test("an RFA badge followed by a new contract keeps the new contract's first cap hit", () => {
  const celebrini = parseYearlyPage(yearly).rows.find((row) => row.name === "Macklin Celebrini");
  assert.deepEqual(celebrini.capHits, { "2026-27": 975000, "2027-28": 18800000, "2028-29": 18800000, "2029-30": 18800000 });
  assert.deepEqual(celebrini.expiries, [{ season: "2027-28", status: "RFA" }]);
  assert.deepEqual(celebrini.clauses, { "2029-30": "NMC" });
});
