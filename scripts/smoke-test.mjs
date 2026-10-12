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
import { buildSeasonList, buildTeamData } from "../src/cap-math.js";
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
  // The footer only renders once the data has loaded, on every view.
  await page.waitForSelector(".site-footer", { timeout: 15000 });
  return page;
}
const pathOf = (page) => new URL(page.url()).pathname;
// Text whose color has less than `min` contrast against white.
const unreadable = (page, selector, min) => page.evaluate(([sel, minRatio]) => {
  const ratio = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
  };
  return [...document.querySelectorAll(sel)].filter((el) => ratio(getComputedStyle(el).color) < minRatio).map((el) => el.textContent);
}, [selector, min]);

try {
  const page = await openPage(1400, "/teams/TOR");
  check((await page.locator(".cap-sheet tbody tr").count()) >= 15, "/teams/TOR opens Toronto's cap sheet");
  check((await page.locator(".team-card, .league-bar").count()) === 0, "a team page shows only that team");
  check((await page.locator(".back-link").getAttribute("href")) === "/", "a team page links back to all teams");
  check((await page.locator(".data-badge.ice").innerText()).includes(ceiling), `header shows the ${season} ceiling ${ceiling}`);
  check((await page.title()) === pageTitle({ season, view: "dashboard" }, toronto), "the page title names the team");
  check((await page.locator(".prerender").count()) === 0, "the app replaces the static summary");
  check((await page.locator(".site-footer").innerText()).includes("Spotrac"), "footer credits the data sources");

  // Views render after navigation, so wait for each one.
  await page.click(".back-link");
  await page.waitForSelector(".team-card");
  check(pathOf(page) === "/" && (await page.locator(".team-card").count()) === data.teams.length, `the back link returns to all ${data.teams.length} teams`);
  check((await page.locator(".league-bar").count()) === 1, "the dashboard shows the league summary");
  const teamsNow = buildTeamData(data, season, data.meta.caps[season].ceiling);
  const overNow = teamsNow.filter((t) => t.capStatus === "over").length;
  const ltirNow = teamsNow.filter((t) => t.capStatus === "ltir").length;
  const overStat = page.locator(".league-stat", { hasText: "Teams Over Cap" });
  check((await overStat.locator(".league-stat-val").innerText()).trim() === String(overNow),
    `teams over the cap counts LTIR relief (${overNow} over, ${ltirNow} covered by LTIR)`);
  if (ltirNow) {
    check((await page.locator(".cap-space-label", { hasText: "LTIR" }).count()) === ltirNow, "teams on LTIR relief are marked on their cards");
  }
  const faintCodes = await unreadable(page, ".team-abbr", 3);
  check(faintCodes.length === 0, `team codes on the cards are readable on white${faintCodes.length ? ` (not: ${faintCodes.join(", ")})` : ""}`);
  await page.locator('.team-card[href="/teams/TOR"]').click();
  await page.waitForSelector(".cap-sheet");
  check(pathOf(page) === "/teams/TOR", "a team card opens the team page");

  await page.click('.nav-btn:has-text("Standings")');
  await page.waitForSelector(".standings-division");
  check((await page.locator(".standings-table, .sample-banner").count()) > 0, "standings view renders");
  check(pathOf(page) === "/standings", "the URL follows the view");
  const faintStandings = await unreadable(page, ".std-abbr", 4.5);
  check(faintStandings.length === 0, `team codes in standings are readable on white${faintStandings.length ? ` (not: ${faintStandings.join(", ")})` : ""}`);
  await page.goBack();
  await page.waitForSelector(".cap-sheet");
  check(pathOf(page) === "/teams/TOR", "back returns to the cap sheet");
  await page.goForward();
  await page.waitForSelector(".standings-division");
  check(pathOf(page) === "/standings", "forward returns to standings");
  await page.locator(".standings-table tbody tr").first().click();
  await page.waitForSelector(".cap-sheet");
  check(/^\/standings\/[A-Z]{3}$/.test(pathOf(page)) && (await page.locator(".back-link").getAttribute("href")) === "/standings",
    "a standings row opens the team page, linking back to standings");
  await page.goBack();
  await page.waitForSelector(".standings-division");

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
  check((await old.locator(".stale-banner").count()) === 0, "a refreshed team shows no stale-data note");
  await old.close();

  // A team whose Spotrac pages the refresh couldn't read is flagged. The data
  // is served with meta.staleTeams added, so the real file isn't touched.
  const staleData = { ...data, meta: { ...data.meta, staleTeams: { CGY: { since: "2026-10-11", pages: [season] } } } };
  const stale = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  stale.on("pageerror", (error) => failures.push(`stale page error: ${error.message}`));
  await stale.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await stale.route("**/data/nhl-cap-data.json", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(staleData) }));
  await stale.goto(base + "/teams/CGY");
  await stale.waitForSelector(".cap-sheet");
  check(await stale.locator(".stale-banner").isVisible(), "a team the refresh couldn't read says its data is older");
  await stale.goto(base + "/");
  await stale.waitForSelector(".team-card");
  check((await stale.locator(".stale-note").innerText()).includes("Calgary"), "the dashboard names teams the refresh couldn't read");
  await stale.close();

  // While the data downloads, a page built for search engines keeps its
  // summary on screen; the app replaces it once the data is in.
  const slow = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  slow.on("pageerror", (error) => failures.push(`slow page error: ${error.message}`));
  await slow.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  let releaseData;
  const dataHeld = new Promise((resolve) => (releaseData = resolve));
  await slow.route("**/data/nhl-cap-data.json", async (route) => {
    await dataHeld;
    await route.continue();
  });
  await slow.goto(base + "/teams/TOR");
  await slow.waitForTimeout(500);
  check((await slow.locator(".prerender").isVisible()) && (await slow.locator(".loading-state").count()) === 0,
    "the static summary stays on screen while the data loads");
  releaseData();
  await slow.waitForSelector(".cap-sheet");
  check((await slow.locator(".prerender").count()) === 0, "then the app replaces it");
  await slow.close();

  // A clause that only starts with an extension is named on the cap sheet.
  const sheetItem = (team, playerId) => data.capSheets[season][team]?.items.find((item) => item.playerId === playerId);
  const extension = data.contracts.find((later) => later.clause && later.startSeason > season &&
    data.contracts.some((c) => c.team === later.team && c.playerId === later.playerId && !c.clause &&
      buildSeasonList(c.startSeason, c.years).includes(season) && sheetItem(c.team, c.playerId) && !sheetItem(c.team, c.playerId).clause));
  if (extension) {
    const ext = await openPage(1400, `/teams/${extension.team}`);
    await ext.waitForSelector(".cap-sheet");
    const label = `${extension.clause} from ${extension.startSeason}`;
    check((await ext.locator(".later-clause", { hasText: label }).count()) >= 1,
      `a clause that starts with an extension is shown (${extension.team}: ${label})`);
    await ext.close();
  }

  for (const urlPath of ["/teams/TOR", "/standings", "/trade", "/projections"]) {
    const phone = await openPage(390, urlPath);
    await phone.waitForTimeout(300);
    const width = await phone.evaluate(() => document.documentElement.scrollWidth);
    check(width <= 390, `${urlPath} fits a 390px screen (page width ${width}px)`);
    if (urlPath === "/teams/TOR") {
      check(await phone.locator(".swipe-hint").isVisible(), "on a phone the cap sheet says it swipes for later seasons");
    }
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
