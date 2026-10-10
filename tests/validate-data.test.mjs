import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { validateData } from "../scripts/validate-data.mjs";

const committed = JSON.parse(fs.readFileSync(new URL("../data/nhl-cap-data.json", import.meta.url), "utf8"));
const copy = () => structuredClone(committed);
const current = committed.meta.seasons[0];
const firstItem = (data) => {
  const [abbr, sheet] = Object.entries(data.capSheets[current])[0];
  return { abbr, sheet, item: sheet.items.find((item) => item.kind === "player" && item.capHit > 0) };
};
const errorsOf = (data) => validateData(data).errors.join("\n");

test("the committed data passes", () => {
  assert.deepEqual(validateData(committed).errors, []);
});

test("a cap sheet player without a contract is caught", () => {
  const data = copy();
  const { abbr, item } = firstItem(data);
  data.contracts = data.contracts.filter((c) => !(c.team === abbr && c.playerId === item.playerId));
  assert.match(errorsOf(data), /has no contract covering this season/);
});

test("a cap hit that no longer matches Spotrac's total is caught", () => {
  const data = copy();
  const { item } = firstItem(data);
  item.capHit += 1_000_000;
  data.contracts.find((c) => c.playerId === item.playerId).capHits[current] += 1_000_000;
  assert.match(errorsOf(data), /differs from Spotrac's total allocations .* by \$1,000,000/);
});

test("a dollar figure in the position column is caught", () => {
  const data = copy();
  data.players[0].pos = "$1,000,000";
  assert.match(errorsOf(data), /invalid position "\$1,000,000"/);
});

test("duplicate players and overlapping contracts are caught", () => {
  const data = copy();
  data.players.push({ ...data.players[0] });
  data.contracts.push({ ...data.contracts[0] });
  const errors = errorsOf(data);
  assert.match(errors, /duplicate player id/);
  assert.match(errors, /overlapping contracts/);
});

test("a missing current-season sheet fails; a missing future one only warns", () => {
  const data = copy();
  const abbr = data.teams[0].abbr;
  delete data.capSheets[current][abbr];
  delete data.capSheets[data.meta.seasons[3]][abbr];
  const { errors, warnings } = validateData(data);
  assert.ok(errors.includes(`${current} ${abbr}: no cap sheet`));
  assert.ok(warnings.includes(`${data.meta.seasons[3]} ${abbr}: no cap sheet`));
});
