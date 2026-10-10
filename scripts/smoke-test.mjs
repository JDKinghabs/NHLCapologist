// Opens the built site (dist/) in headless Chromium and checks that every view
// renders the data, at desktop and phone widths, with no page errors and no
// third-party scripts; also checks the static team pages and sitemap. Run
// `npm run build` first.
//
// Usage: npm run smoke
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { pageTitle } from "../src/routes.js";
import { createStaticServer } from "./static-server.mjs";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const data = JSON.parse(fs.readFileSync(path.join(dist, "data", "nhl-cap-data.json"), "utf8"));
const season = data.meta.seasons[0];
const ceiling = `$${(data.meta.caps[season].ceiling / 1e6).toFixed(2)}M`;
const toronto = data.teams.find((team) => team.abbr === "TOR").name;

const server = createStaticServer(dist);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

// Static pages for search engines
const teamPages = fs.readdirSync(path.join(dist, "teams")).filter((file) => file.endsWith(".html"));
const titles = teamPages.map((file) => fs.readFileSync(path.join(dist, "teams", file), "utf8").match(/<title>([^<]*)<\/title>/)?.[1]);
check(teamPages.length === data.teams.length && new Set(titles).size === teamPages.length, `${data.teams.length} team pages, each with its own title`);
const torPage = fs.readFileSync(path.join(dist, "teams", "TOR.html"), "utf8");
check(torPage.includes('/teams/TOR"/>') && /<table>.*Largest cap hits/.test(torPage), "a team page has its canonical link and cap hit table");
const sitemapUrls = (fs.readFileSync(path.join(dist, "sitemap.xml"), "utf8").match(/<loc>/g) || []).length;
check(sitemapUrls === data.teams.length + 4, `sitemap lists home, 3 views and ${data.teams.length} teams (${sitemapUrls} URLs)`);

const browser = await chromium.launch();
async function openPage(width, urlPath) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on("pageerror", (error) => failures.push(`${width}px page error: ${error.message}`));
  // Web fonts are cosmetic; skip them so the check doesn't depend on Google.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  page.on("request", (request) => {
    const host = new URL(request.url()).hostname;
    if (host !== "127.0.0.1" && !/^fonts\./.test(host)) failures.push(`${width}px third-party request: ${request.url()}`);
  });
  await page.goto(base + urlPath);
  await page.waitForSelector(".league-bar", { timeout: 15000 });
  return page;
}
const pathOf = (page) => new URL(page.url()).pathname;

try {
  const page = await openPage(1400, "/teams/TOR");
  check((await page.locator(".team-card").count()) === data.teams.length, `dashboard shows all ${data.teams.length} teams`);
  check((await page.locator(".data-badge.ice").innerText()).includes(ceiling), `header shows the ${season} ceiling ${ceiling}`);
  check((await page.locator(".cap-sheet tbody tr").count()) >= 15, "/teams/TOR opens Toronto's cap sheet");
  check((await page.title()) === pageTitle({ season, view: "dashboard" }, toronto), "the page title names the team");
  check((await page.locator(".prerender").count()) === 0, "the app replaces the static summary");
  check((await page.locator(".site-footer").innerText()).includes("Spotrac"), "footer credits the data sources");

  // Views render after navigation, so wait for each one.
  await page.click('.nav-btn:has-text("Standings")');
  await page.waitForSelector(".standings-division");
  check((await page.locator(".standings-table, .sample-banner").count()) > 0, "standings view renders");
  check(pathOf(page) === "/standings", "the URL follows the view");
  await page.goBack();
  await page.waitForSelector(".cap-sheet");
  check(pathOf(page) === "/teams/TOR", "back returns to the cap sheet");
  await page.goForward();
  await page.waitForSelector(".standings-division");
  check(pathOf(page) === "/standings", "forward returns to standings");

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

  const old = await openPage(1400, `/#/${season}/dashboard/TOR`);
  await old.waitForSelector(".cap-sheet");
  check(pathOf(old) === "/teams/TOR" && !new URL(old.url()).hash, "an old #/ link moves to /teams/TOR");
  await old.close();

  for (const urlPath of ["/teams/TOR", "/standings", "/trade", "/projections"]) {
    const phone = await openPage(390, urlPath);
    await phone.waitForTimeout(300);
    const width = await phone.evaluate(() => document.documentElement.scrollWidth);
    check(width <= 390, `${urlPath} fits a 390px screen (page width ${width}px)`);
    await phone.close();
  }
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
