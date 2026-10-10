import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";

process.env.SEASON = "2026-27";
const {
  capTotalsCharges,
  checkAgainstSpotracTotals,
  classifySection,
  dropImpossibleCapHits,
  parseTeamPage,
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
  const parsed = parseTeamPage({ abbr: "NYI" }, page);
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
  const { minors } = parseTeamPage({ abbr: "NYI" }, page);
  const engvall = byName(minors, "Pierre Engvall");
  assert.deepEqual(
    [engvall.pos, engvall.totalCap, engvall.adjustedCap, engvall.buried, engvall.clause],
    ["LW", 3000000, 1775000, true, "M-NTC"]
  );
  assert.equal(byName(minors, "Vladimir Dravecky").incentives, 72500);
});

test("reads Spotrac's cap totals", () => {
  const { totals } = parseTeamPage({ abbr: "NYI" }, page);
  assert.equal(totals["Salary Cap Maximum"], "$104,000,000");
  assert.equal(totals["Total Allocations"], "$29,668,750");
});

test("accepts a page whose tables add up to Spotrac's total", () => {
  const parsed = parseTeamPage({ abbr: "NYI" }, page);
  assert.doesNotThrow(() => checkAgainstSpotracTotals(parsed, []));
});

test("refuses a page whose tables don't add up", () => {
  const parsed = parseTeamPage({ abbr: "NYI" }, page);
  parsed.active.pop();
  assert.throws(() => checkAgainstSpotracTotals(parsed, []), /Spotrac reports \$29,668,750/);
});

test("refuses a table with columns it doesn't recognize", () => {
  const renamed = page.replaceAll('id="position1_abbreviation"', 'id="pos"');
  assert.throws(() => parseTeamPage({ abbr: "NYI" }, renamed), /Unrecognized table columns/);
});

test("skips cap hits above the max salary and still reconciles", () => {
  const bogus = page
    .replace('data-sort="986250"> <span class=" "> $986,250 </span> </td> <td class="dt-ordering-desc', 'data-sort="157608247"> <span class=" "> $157,608,247 </span> </td> <td class="dt-ordering-desc')
    .replace('data-sort="986250"> <span class=" "> $986,250 </span>', 'data-sort="157608247"> <span class=" "> $157,608,247 </span>')
    .replace("$29,668,750", "$186,290,747");
  const parsed = parseTeamPage({ abbr: "NYI" }, bogus);
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
