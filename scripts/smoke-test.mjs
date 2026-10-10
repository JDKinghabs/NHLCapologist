// Opens the built site (dist/) in headless Chromium and checks that every view
// renders the data, at desktop and phone widths, with no page errors and no
// third-party scripts. Run `npm run build` first.
//
// Usage: npm run smoke
import { createServer } from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const data = JSON.parse(fs.readFileSync(path.join(dist, "data", "nhl-cap-data.json"), "utf8"));
const season = data.meta.seasons[0];
const ceiling = `$${(data.meta.caps[season].ceiling / 1e6).toFixed(2)}M`;

const server = createServer((req, res) => {
  const file = path.join(dist, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
  if (!file.startsWith(dist) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch();
async function openPage(width, hash) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (error) => failures.push(`${width}px page error: ${error.message}`));
  // Web fonts are cosmetic; skip them so the check doesn't depend on Google.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  page.on("request", (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== "127.0.0.1" && !/^fonts\./.test(host)) failures.push(`${width}px third-party request: ${request.url()}`);
  });
  await page.goto(base + hash);
  await page.waitForSelector(".league-bar", { timeout: 15000 });
  return page;
}

try {
  const page = await openPage(1400, `#/${season}/dashboard/TOR`);
  check((await page.locator(".team-card").count()) === data.teams.length, `dashboard shows all ${data.teams.length} teams`);
  check((await page.locator(".data-badge.ice").innerText()).includes(ceiling), `header shows the ${season} ceiling ${ceiling}`);
  check((await page.locator(".cap-sheet tbody tr").count()) >= 15, "a linked team's cap sheet opens with its players");
  check((await page.locator(".site-footer").innerText()).includes("Spotrac"), "footer credits the data sources");

  // Views render after the hashchange event, so wait for each one.
  await page.click('.nav-btn:has-text("Standings")');
  await page.waitForSelector(".standings-division");
  check((await page.locator(".standings-table, .sample-banner").count()) > 0, "standings view renders");
  check(page.url().endsWith(`#/${season}/standings`), "the URL follows the view");

  await page.click('.nav-btn:has-text("Trade")');
  await page.waitForSelector(".trade-layout");
  const panels = page.locator(".trade-panel");
  await panels.nth(0).locator(".trade-player-row").first().click();
  await panels.nth(1).locator(".trade-player-row").first().click();
  check((await page.locator(".trade-summary-team").count()) === 2, "trade tool evaluates a two-team trade");

  await page.click('.nav-btn:has-text("Projections")');
  await page.waitForSelector(".proj-season-row");
  check((await page.locator(".proj-season-row").count()) === data.meta.seasons.length, "projections show every season");
  await page.close();

  const phone = await openPage(390, `#/${season}/dashboard/TOR`);
  for (const view of ["dashboard/TOR", "standings", "trade", "projections"]) {
    await phone.evaluate((hash) => (location.hash = hash), `#/${season}/${view}`);
    await phone.waitForTimeout(300);
    const width = await phone.evaluate(() => document.documentElement.scrollWidth);
    check(width <= 390, `${view} fits a 390px screen (page width ${width}px)`);
  }
  await phone.close();
} catch (error) {
  failures.push(error.message);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\nSmoke test failed:\n- ${[...new Set(failures)].join("\n- ")}`);
  process.exit(1);
}
console.log("\nSmoke test passed.");
