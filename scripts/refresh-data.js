// Refresh data/nhl-cap-data.json by re-scraping Spotrac. For each team it
// reads two pages: the current season's cap page (every roster group, buried
// and retained amounts, Spotrac's totals) and the multi-year page (each
// player's cap hit for every future season, age, and UFA/RFA status at
// expiry). Players and contracts are rebuilt from the resulting cap sheets.
//
// It:
//   - rolls the season window forward on July 1 (see season-window.mjs)
//   - throttles + retries the 64 page requests
//   - writes atomically (temp file + rename) so a partial/failed scrape can
//     never corrupt the existing ~1 MB JSON; teams that fail keep their
//     last-known-good cap sheet.
//   - leaves the JSON untouched when Spotrac reports nothing new, so a run
//     never produces a commit that only bumps date stamps.
//
// Usage:
//   node scripts/refresh-data.js            # all 32 teams
//   node scripts/refresh-data.js TOR        # single team
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { applyCapCeilings, currentSeason, rollSeasonWindow, seasonAt } from "./season-window.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, "..", "data", "nhl-cap-data.json");

const FETCH_DATE = new Date().toISOString().slice(0, 10);
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const TARGET_ABBR = (process.argv[2] || "").toUpperCase();
const DEBUG_ABBR = (process.env.SPOTRAC_DEBUG || "").toUpperCase();
// One or more names separated by "|".
const DEBUG_PLAYERS = (process.env.SPOTRAC_DEBUG_PLAYER || "").split("|").map((name) => name.trim()).filter(Boolean);
const namesDebugPlayer = (row) => DEBUG_PLAYERS.some((name) => row.includes(name));
const DRY_RUN = process.env.REFRESH_DRY_RUN === "true";
const DEBUG_URLS = (process.env.SPOTRAC_DEBUG_URL || "").split(",").map((url) => url.trim()).filter(Boolean);

const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS) || 1500;
const MAX_RETRIES = Number(process.env.MAX_RETRIES) || 3;
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) || 30000;

const TEAM_SOURCES = [
  { abbr: "BOS", slug: "boston-bruins" },
  { abbr: "BUF", slug: "buffalo-sabres" },
  { abbr: "DET", slug: "detroit-red-wings" },
  { abbr: "FLA", slug: "florida-panthers" },
  { abbr: "MTL", slug: "montreal-canadiens" },
  { abbr: "OTT", slug: "ottawa-senators" },
  { abbr: "TBL", slug: "tampa-bay-lightning" },
  { abbr: "TOR", slug: "toronto-maple-leafs" },
  { abbr: "CAR", slug: "carolina-hurricanes" },
  { abbr: "CBJ", slug: "columbus-blue-jackets" },
  { abbr: "NJD", slug: "new-jersey-devils" },
  { abbr: "NYI", slug: "new-york-islanders" },
  { abbr: "NYR", slug: "new-york-rangers" },
  { abbr: "PHI", slug: "philadelphia-flyers" },
  { abbr: "PIT", slug: "pittsburgh-penguins" },
  { abbr: "WSH", slug: "washington-capitals" },
  { abbr: "CHI", slug: "chicago-blackhawks" },
  { abbr: "COL", slug: "colorado-avalanche" },
  { abbr: "DAL", slug: "dallas-stars" },
  { abbr: "MIN", slug: "minnesota-wild" },
  { abbr: "NSH", slug: "nashville-predators" },
  { abbr: "STL", slug: "st-louis-blues" },
  { abbr: "UTA", slug: "utah-mammoth" },
  { abbr: "WPG", slug: "winnipeg-jets" },
  { abbr: "ANA", slug: "anaheim-ducks" },
  { abbr: "CGY", slug: "calgary-flames" },
  { abbr: "EDM", slug: "edmonton-oilers" },
  { abbr: "LAK", slug: "los-angeles-kings" },
  { abbr: "SJS", slug: "san-jose-sharks" },
  { abbr: "SEA", slug: "seattle-kraken" },
  { abbr: "VAN", slug: "vancouver-canucks" },
  { abbr: "VGK", slug: "vegas-golden-knights" },
];

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&eacute;/g, "e")
    .replace(/&Eacute;/g, "E")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function safeNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function parseMoneyText(text) {
  return safeNum(String(text || "").replace(/[$,%\s,]/g, ""));
}

function stripTags(text) {
  return decodeHtml(String(text || "").replace(/<[^>]+>/g, " "));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function capPageUrl(teamSource, season) {
  return `https://www.spotrac.com/nhl/${teamSource.slug}/cap/_/year/${season.slice(0, 4)}`;
}

function yearlyPageUrl(teamSource) {
  return `https://www.spotrac.com/nhl/${teamSource.slug}/yearly/`;
}

async function fetchUrl(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (html.length < 5000) throw new Error(`suspiciously short body (${html.length} bytes)`);
      return html;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        const backoff = REQUEST_DELAY_MS * attempt;
        console.warn(`  ${teamSource.abbr} attempt ${attempt} failed (${error.message}); retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`fetch failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

function extractTableHtml(html, headingText) {
  const escaped = headingText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<div class="table-header[^"]*">[\\s\\S]*?<h2>[\\s\\S]*?${escaped}[\\s\\S]*?<\\/h2>[\\s\\S]*?<table[^>]*>([\\s\\S]*?)<\\/table>`,
    "i"
  );
  const match = html.match(pattern);
  if (!match) {
    throw new Error(`Could not find section "${headingText}"`);
  }
  return match[1];
}

// Every cap table on a team page sits under a "<season> ..." heading. Each
// match is limited to its own table-header block, so a heading with no table
// can never borrow the next section's rows.
function extractSeasonSections(html, season) {
  const pattern =
    /<div class="table-header[^"]*">((?:(?!<div class="table-header)[\s\S])*?)<table[^>]*>([\s\S]*?)<\/table>/gi;
  const sections = [];
  let match;
  while ((match = pattern.exec(html))) {
    const h2 = match[1].match(/<h2>([\s\S]*?)<\/h2>/i);
    const heading = h2 ? stripTags(h2[1]) : "";
    if (heading.startsWith(`${season} `)) sections.push({ title: heading.slice(season.length + 1), tableHtml: match[2] });
  }
  return sections;
}

// Maps a Spotrac section title to a cap-sheet player category or adjustment kind.
function classifySection(title) {
  const t = title.toLowerCase();
  if (t.includes("cap totals")) return "totals";
  if (t.includes("buyout")) return "buyout";
  if (t.includes("retained")) return "retained";
  if (/long[- ]term|ltir/.test(t)) return "ltir";
  if (t.includes("injured")) return "ir";
  if (/non[- ]roster/.test(t)) return "nonRoster";
  if (/reserve|suspended/.test(t)) return "reserve";
  if (t.includes("minor")) return "minors";
  if (t.includes("active")) return "active";
  if (/dead|termination|recapture/.test(t)) return "other";
  return null;
}

// SPOTRAC_DEBUG=<ABBR> prints that team's table markup (header block, <thead>
// and the first rows of every table) to the log, so the parser can be checked
// against Spotrac's real HTML. SPOTRAC_DEBUG_PLAYER also prints rows naming
// that player.
function dumpMarkup(html, abbr) {
  const squash = (text) => text.replace(/\s+/g, " ").trim().slice(0, 3000);
  const pattern =
    /<div class="table-header[^"]*">((?:(?!<div class="table-header)[\s\S])*?)<table([^>]*)>([\s\S]*?)<\/table>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const [, header, tableAttrs, tableHtml] = match;
    const thead = (tableHtml.match(/<thead>([\s\S]*?)<\/thead>/i) || [])[1] || "";
    const rows = extractTbody(tableHtml).match(/<tr[\s\S]*?<\/tr>/gi) || [];
    console.log(`[debug ${abbr}] SECTION ${squash(stripTags(header))} | rows=${rows.length} | table${squash(tableAttrs)}`);
    console.log(`[debug ${abbr}] THEAD ${squash(thead)}`);
    rows.slice(0, 2).forEach((row) => console.log(`[debug ${abbr}] ROW ${squash(row)}`));
    rows.filter(namesDebugPlayer).forEach((row) => console.log(`[debug ${abbr}] MATCH ${squash(row)}`));
  }
}

// SPOTRAC_DEBUG_URL=<url>[,<url>...] fetches arbitrary Spotrac pages and
// prints their headings and every table's header and first rows, to explore
// pages the refresh doesn't read yet. Nothing else runs.
async function dumpPages(urls) {
  const squash = (text) => text.replace(/\s+/g, " ").trim().slice(0, 2500);
  for (const url of urls) {
    try {
      const html = await fetchUrl(url);
      const headings = Array.from(html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)).map((m) => squash(stripTags(m[1]))).filter(Boolean);
      console.log(`[debug-url ${url}] ${html.length} bytes | headings: ${headings.join(" | ").slice(0, 2500)}`);
      for (const [, attrs, tableHtml] of html.matchAll(/<table([^>]*)>([\s\S]*?)<\/table>/gi)) {
        const thead = (tableHtml.match(/<thead>([\s\S]*?)<\/thead>/i) || [])[1] || "";
        const rows = (tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1] || tableHtml).match(/<tr[\s\S]*?<\/tr>/gi) || [];
        console.log(`[debug-url] TABLE${squash(attrs)} rows=${rows.length} | THEAD ${squash(stripTags(thead.replace(/<\/th>/gi, " | </th>")))}`);
        // Summary tables print every row as text; others print their first rows' markup.
        if (/summary/i.test(attrs)) {
          rows.forEach((row) => console.log(`[debug-url] SUMMARY ${squash(stripTags(row.replace(/<\/td>/gi, " | </td>")))}`));
        } else {
          rows.slice(0, 2).forEach((row) => console.log(`[debug-url] ROW ${squash(row)}`));
          rows.filter(namesDebugPlayer).forEach((row) => console.log(`[debug-url] MATCH ${row.replace(/\s+/g, " ").slice(0, 6000)}`));
        }
      }
    } catch (error) {
      console.log(`[debug-url ${url}] ${error.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
}

function extractTbody(tableHtml) {
  const match = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  return match ? match[1] : "";
}

// Spotrac's player tables identify each column by a stable <th id>.
const COLUMN_IDS = {
  pos: "position1_abbreviation",
  totalCap: "cap_total",
  adjustedCap: "cap_total2",
  baseSalary: "cap_base",
  signingBonus: "cap_signing",
  incentives: "cap_incentive_likely",
};

function parseColumnIds(tableHtml) {
  const thead = (tableHtml.match(/<thead>([\s\S]*?)<\/thead>/i) || [])[1] || "";
  return Array.from(thead.matchAll(/<th\b[^>]*?\bid="([^"]*)"/gi)).map((match) => match[1]);
}

// A cell's value is its data-sort attribute when present (most tables),
// otherwise its text (the Minor table has no data-sort attributes).
function parseCells(rowHtml) {
  return Array.from(rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)).map(([, attrs, inner]) => {
    const sort = attrs.match(/data-sort="([^"]*)"/i);
    return sort ? decodeHtml(sort[1]) : stripTags(inner);
  });
}

function parsePlayerRows(tableHtml) {
  const columnIds = parseColumnIds(tableHtml);
  const tbody = extractTbody(tableHtml);
  const rows = [];
  const rowPattern = /<tr class="[^"]*">([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(tbody))) {
    const rowHtml = rowMatch[1];
    const playerMatch = rowHtml.match(/player\/_\/id\/(\d+)\/[^"]+" class="link[^"]*"[^>]*>([^<]+)<\/a>/i);
    if (!playerMatch) continue;
    if (![COLUMN_IDS.pos, COLUMN_IDS.adjustedCap].every((id) => columnIds.includes(id))) {
      throw new Error(`Unrecognized table columns: ${columnIds.join(", ") || "(no <thead>)"}`);
    }

    const cells = parseCells(rowHtml);
    const cell = (key) => cells[columnIds.indexOf(COLUMN_IDS[key])] ?? "";
    // Contract clauses appear as text in the name cell's tooltip ("NTC:", "M-NTC", ...).
    const clause = (rowHtml.match(/\b(M-NMC|M-NTC|NMC|NTC)\b/) || [])[1] || null;

    rows.push({
      spotracId: playerMatch[1],
      name: decodeHtml(playerMatch[2]),
      pos: cell("pos"),
      totalCap: parseMoneyText(cell("totalCap")),
      adjustedCap: parseMoneyText(cell("adjustedCap")),
      baseSalary: parseMoneyText(cell("baseSalary")),
      signingBonus: parseMoneyText(cell("signingBonus")),
      incentives: parseMoneyText(cell("incentives")),
      clause,
      buried: rowHtml.includes("Buried"),
      waived: rowHtml.includes("Waived"),
    });
  }

  return rows;
}

function parseCapTotals(html, season) {
  const tableHtml = extractTableHtml(html, `${season} Cap Totals`);
  const tbody = extractTbody(tableHtml);
  const rows = {};
  const rowPattern = /<tr class="(?:totals|divider)[^"]*">([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(tbody))) {
    const rowHtml = rowMatch[1];
    const labelMatch = rowHtml.match(/<td[^>]*class="text-left[^"]*"[^>]*>\s*([^<]+?)\s*<\/td>/i);
    const valueMatch = rowHtml.match(/<td[^>]*class=" text-center contract[^"]*"[^>]*>\s*([^<]+?)\s*<\/td>/i);
    if (!labelMatch || !valueMatch) continue;
    rows[decodeHtml(labelMatch[1])] = decodeHtml(valueMatch[1]);
  }

  return rows;
}

const PLAYER_KINDS = ["active", "ir", "ltir", "nonRoster", "reserve", "minors"];
const ADJUSTMENT_KINDS = { buyout: "buyout", retained: "retainedSalary", other: "other" };

function parseTeamPage(teamSource, html, season) {
  const parsed = { sections: [], unknown: [] };
  [...PLAYER_KINDS, ...Object.keys(ADJUSTMENT_KINDS)].forEach((kind) => (parsed[kind] = []));

  extractSeasonSections(html, season).forEach(({ title, tableHtml }) => {
    const kind = classifySection(title);
    if (kind === "totals") return;
    const rows = parsePlayerRows(tableHtml);
    const sum = rows.reduce((total, row) => total + row.adjustedCap, 0);
    parsed.sections.push({ title, kind, count: rows.length, sum });
    if (kind) parsed[kind].push(...rows);
    else parsed.unknown.push({ title, count: rows.length, sum });
  });

  if (!parsed.sections.some((section) => section.kind === "active")) {
    throw new Error(`Could not find an "${season} Active Roster" section`);
  }
  parsed.totals = parseCapTotals(html, season);
  return parsed;
}

// A cap hit above the CBA maximum player salary (20% of the ceiling) can only
// be a data error on the source page, so such rows are dropped.
function dropImpossibleCapHits(parsed, maxSalary, abbr) {
  const dropped = [];
  PLAYER_KINDS.forEach((kind) => {
    parsed[kind] = parsed[kind].filter((row) => {
      if (Math.max(row.adjustedCap, row.totalCap) <= maxSalary) return true;
      dropped.push(row);
      console.warn(`  ${abbr}: skipped ${row.name} — Spotrac cap hit ${fmtMoney(Math.max(row.adjustedCap, row.totalCap))} exceeds the ${fmtMoney(maxSalary)} max salary`);
      return false;
    });
  });
  return dropped;
}

// Charges Spotrac lists only in its Cap Totals table, not as a section.
function capTotalsCharges(totals) {
  const charges = [];
  Object.entries(totals).forEach(([label, value]) => {
    const amount = parseMoneyText(value);
    if (!amount) return;
    if (/bonus/i.test(label) && /charge|overage/i.test(label)) {
      charges.push({ label, category: "bonusOverage", amount });
    } else if (label === "Adjustment") {
      // A cut to this team's cap maximum; recorded as a charge so cap space matches Spotrac.
      charges.push({ label: "Salary cap maximum adjustment", category: "other", amount: -amount });
    }
  });
  return charges;
}

// Refuses a page whose tables don't add up to Spotrac's own total (e.g. an
// alternate page layout where no rows parse), so the team keeps its
// last-known-good sheet instead of being overwritten with wrong numbers.
function checkAgainstSpotracTotals(parsed, dropped) {
  const sum = (rows) => rows.reduce((total, row) => total + row.adjustedCap, 0);
  const imported =
    [...PLAYER_KINDS, ...Object.keys(ADJUSTMENT_KINDS)].reduce((total, kind) => total + sum(parsed[kind]), 0) +
    capTotalsCharges(parsed.totals).reduce((total, charge) => total + charge.amount, 0);
  // Spotrac's total includes any skipped rows but not the cap-maximum cut the sheet records as a charge.
  const expected =
    parseMoneyText(parsed.totals["Total Allocations"]) - parseMoneyText(parsed.totals["Adjustment"]) - sum(dropped);
  if (!parsed.active.length || Math.abs(imported - expected) > 1000) {
    const totals = Object.entries(parsed.totals).map(([label, value]) => `${label}=${value}`).join("; ");
    throw new Error(`parsed tables total ${fmtMoney(imported)} but Spotrac reports ${fmtMoney(expected)} [Cap Totals: ${totals}]`);
  }
}

function fmtMoney(amount) {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

function buildCapSheet(teamSource, season, parsed, dropped) {
  const items = [];
  const adjustments = [];

  PLAYER_KINDS.forEach((category) => {
    parsed[category].forEach((row) => {
      items.push({
        kind: "player",
        playerId: `SR_${row.spotracId}`,
        category,
        capHit: row.adjustedCap,
        // The full cap hit, when burying in the minors reduces what counts.
        ...(row.totalCap !== row.adjustedCap ? { aav: row.totalCap } : {}),
        ...(row.baseSalary ? { baseSalary: row.baseSalary } : {}),
        ...(row.signingBonus ? { signingBonus: row.signingBonus } : {}),
        ...(row.incentives ? { incentives: row.incentives } : {}),
        ...(row.clause ? { clause: row.clause } : {}),
        ...(category === "minors" ? { notes: row.buried ? ["Buried"] : [] } : {}),
      });
    });
  });

  Object.entries(ADJUSTMENT_KINDS).forEach(([kind, category]) => {
    parsed[kind].forEach((row, idx) => {
      adjustments.push({
        id: `${teamSource.abbr}-${kind}-${idx + 1}`,
        label: row.name,
        category,
        amount: row.adjustedCap,
        notes:
          kind === "buyout"
            ? row.waived ? "Waived / buyout charge from Spotrac" : "Buyout charge from Spotrac"
            : kind === "retained" ? "Retained salary charge from Spotrac" : "Dead cap charge from Spotrac",
      });
    });
  });

  capTotalsCharges(parsed.totals).forEach((charge, idx) => {
    adjustments.push({
      id: `${teamSource.abbr}-totals-${idx + 1}`,
      label: charge.label,
      category: charge.category,
      amount: charge.amount,
      notes: "From Spotrac cap totals",
    });
  });

  const sectionSummary = parsed.sections.map((section) => `${section.title}=${section.sum}`).join("; ");
  const notes = [
    `Imported from Spotrac ${season} cap table on ${FETCH_DATE}.`,
    `Source URL: ${capPageUrl(teamSource, season)}`,
    `Sections: ${sectionSummary}.`,
    `Spotrac total allocations=${parsed.totals["Total Allocations"] || "n/a"}; cap space=${parsed.totals["Cap Space"] || "n/a"}.`,
  ];
  dropped.forEach((row) => notes.push(`Skipped ${row.name}: Spotrac cap hit ${fmtMoney(Math.max(row.adjustedCap, row.totalCap))} exceeds the max player salary.`));

  return { status: "complete", items, adjustments, notes };
}

function moneyIn(text) {
  const match = String(text || "").match(/\$\s*(-?[\d,]+)/);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

// Multi-year page tables are identified by their id (dataTable-active,
// dataTable-long-term-injured, ...) or class (the Minor and Summary tables).
function yearlyTableKind(attrs) {
  const id = (attrs.match(/\bid="([^"]*)"/i) || [])[1] || "";
  const cls = (attrs.match(/\bclass="([^"]*)"/i) || [])[1] || "";
  if (/yearly-minors-table/.test(cls)) return "minors";
  if (/\bsummary\b/.test(cls)) return "summary";
  if (!/dataTable-yearly/.test(cls)) return null;
  const key = id.replace(/^dataTable-/, "");
  if (/long-term/.test(key)) return "ltir";
  if (/injured/.test(key)) return "ir";
  if (/reserve|suspend/.test(key)) return "reserve";
  if (/non-roster/.test(key)) return "nonRoster";
  if (/active/.test(key)) return "active";
  if (/dead|buyout/.test(key)) return "buyout";
  if (/retained/.test(key)) return "retained";
  return `unknown:${id}`;
}

// The multi-year page has one table per roster group, a column per season
// holding the player's cap hit (or a UFA/RFA badge in the season after a
// contract ends), plus a Summary table of per-season totals. When a player
// has already signed his next contract, the badge cell carries that
// contract's first cap hit in data-export and later seasons continue it.
function parseYearlyPage(html) {
  const page = { rows: [], summary: {}, unknown: [] };
  for (const [, attrs, tableHtml] of html.matchAll(/<table([^>]*)>([\s\S]*?)<\/table>/gi)) {
    const kind = yearlyTableKind(attrs);
    if (!kind) continue;
    if (kind.startsWith("unknown:")) {
      page.unknown.push(kind.slice("unknown:".length));
      continue;
    }
    const thead = (tableHtml.match(/<thead>([\s\S]*?)<\/thead>/i) || [])[1] || "";
    const headers = Array.from(thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)).map((match) => stripTags(match[1]));
    const seasonColumns = headers.map((header, idx) => [header, idx]).filter(([header]) => /^\d{4}-\d{2}$/.test(header));
    const rows = (extractTbody(tableHtml) || tableHtml).match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    const cellsOf = (rowHtml) => Array.from(rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)).map((match) => match[2]);
    const exportsOf = (rowHtml) => Array.from(rowHtml.matchAll(/<td\b([^>]*)>/gi)).map((match) => safeNum((match[1].match(/data-export="(\d+)"/) || [])[1]));

    if (kind === "summary") {
      rows.forEach((rowHtml) => {
        const cells = cellsOf(rowHtml);
        const label = stripTags(cells[0]);
        if (label) page.summary[label] = Object.fromEntries(seasonColumns.map(([season, idx]) => [season, moneyIn(stripTags(cells[idx]))]));
      });
      continue;
    }

    const column = (name) => headers.findIndex((header) => header.toLowerCase() === name);
    rows.forEach((rowHtml) => {
      const link = rowHtml.match(/player\/_\/id\/(\d+)\/[^"]*" class="link[^"]*"[^>]*>([^<]+)<\/a>/i);
      if (!link) return;
      const cells = cellsOf(rowHtml);
      const exported = exportsOf(rowHtml);
      const clauses = {};
      for (const [, season, clause] of rowHtml.matchAll(/(\d{4}-\d{2}):\s*(?:<i[^>]*><\/i>\s*)?(M-NMC|M-NTC|NMC|NTC)\b/gi)) {
        clauses[season] = clause.toUpperCase();
      }
      const capHits = {};
      const expiries = [];
      const amountAt = (idx) => moneyIn(stripTags(cells[idx] || "")) || 0;
      seasonColumns.forEach(([season, idx], col) => {
        const status = ((cells[idx] || "").match(/pill-(ufa|rfa)\b/i) || [])[1];
        if (status) {
          expiries.push({ season, status: status.toUpperCase() });
          const nextIdx = seasonColumns[col + 1]?.[1];
          if (exported[idx] > 0 && nextIdx !== undefined && amountAt(nextIdx) > 0) capHits[season] = exported[idx];
          return;
        }
        const amount = amountAt(idx);
        if (amount > 0) capHits[season] = amount;
      });
      page.rows.push({
        kind,
        spotracId: link[1],
        name: decodeHtml(link[2]),
        pos: stripTags(cells[column("pos")] || ""),
        age: safeNum(stripTags(cells[column("age")] || "")) || null,
        capHits,
        clauses,
        expiries,
      });
    });
  }
  if (!page.rows.some((row) => row.kind === "active") || !page.summary["Total Cap"]) {
    throw new Error("Multi-year page has no Active Roster or Summary table");
  }
  return page;
}

// Future seasons come from the multi-year page. It lists players at their
// full cap hit, so salary another team retains (from that team's Retained
// table) is subtracted. Minor-league players count only for a buried portion
// (if any), so they are kept at capHit 0, and whatever part of Spotrac's
// Total Cap the page doesn't itemize is recorded as one charge. Spotrac's
// projected totals sometimes leave out a listed depth contract, so listed
// contracts may exceed its total by up to OVER_TOTAL_TOLERANCE (noted on the
// sheet); beyond that the page was misread, which fails the team.
const OVER_TOTAL_TOLERANCE = 2_500_000;

function buildFutureSheets(teamSource, page, seasons, maxSalary, retainedElsewhere = new Map()) {
  const abbr = teamSource.abbr;
  const sheets = {};
  seasons.forEach((season) => {
    const items = [];
    const adjustments = [];
    const counts = {};
    let skipped = 0;
    let minorsTotal = 0;

    page.rows.forEach((row) => {
      const capHit = row.capHits[season];
      if (!capHit) return;
      if (capHit > maxSalary(season)) {
        skipped += capHit;
        console.warn(`  ${abbr}: skipped ${row.name} ${season} — Spotrac cap hit ${fmtMoney(capHit)} exceeds the max salary`);
        return;
      }
      const playerId = `SR_${row.spotracId}`;
      if (row.kind === "buyout" || row.kind === "retained") {
        counts[row.kind] = (counts[row.kind] || 0) + 1;
        adjustments.push({
          id: `${abbr}-${row.kind}-${counts[row.kind]}`,
          label: row.name,
          category: row.kind === "buyout" ? "buyout" : "retainedSalary",
          amount: capHit,
          notes: row.kind === "buyout" ? "Buyout charge from Spotrac" : "Retained salary charge from Spotrac",
        });
      } else if (row.kind === "minors") {
        minorsTotal += capHit;
        items.push({ kind: "player", playerId, category: "minors", capHit: 0, aav: capHit, notes: [] });
      } else {
        const retained = retainedElsewhere.get(playerId)?.[season] || 0;
        items.push({
          kind: "player",
          playerId,
          category: "active",
          capHit: Math.max(0, capHit - retained),
          ...(retained ? { aav: capHit } : {}),
          ...(row.clauses[season] ? { clause: row.clauses[season] } : {}),
        });
      }
    });

    const total = page.summary["Total Cap"]?.[season] || 0;
    const listed =
      items.reduce((sum, item) => sum + item.capHit, 0) + adjustments.reduce((sum, adj) => sum + adj.amount, 0);
    const remainder = total - skipped - listed;
    const notes = [
      `Imported from Spotrac multi-year cap table on ${FETCH_DATE}.`,
      `Source URL: ${yearlyPageUrl(teamSource)}`,
      `Spotrac total cap=${fmtMoney(total)}.`,
    ];
    if (remainder < -OVER_TOTAL_TOLERANCE) {
      throw new Error(`${season}: itemized ${fmtMoney(listed)} exceeds Spotrac's total cap ${fmtMoney(total)}`);
    }
    if (remainder < -1000) {
      console.warn(`  ${abbr}: ${season} contracts total ${fmtMoney(-remainder)} more than Spotrac's projected total cap`);
      notes.push(`Contracts listed total ${fmtMoney(-remainder)} more than Spotrac's projected total cap.`);
    }
    if (remainder > 1000) {
      if (remainder > minorsTotal + 1_000_000) {
        console.warn(`  ${abbr}: ${season} has ${fmtMoney(remainder)} of unitemized cap, more than its minor-league contracts`);
      }
      adjustments.push({
        id: `${abbr}-buried-1`,
        label: "Buried contracts and other charges",
        category: "buried",
        amount: remainder,
        notes: "Part of Spotrac's total cap not itemized on its multi-year page",
      });
    }

    sheets[season] = { status: "complete", items, adjustments, notes };
  });
  return sheets;
}

function retainedByPlayer(pages) {
  const retained = new Map();
  pages.forEach((page) =>
    page.rows
      .filter((row) => row.kind === "retained")
      .forEach((row) => {
        const seasons = retained.get(`SR_${row.spotracId}`) || {};
        Object.entries(row.capHits).forEach(([season, amount]) => (seasons[season] = (seasons[season] || 0) + amount));
        retained.set(`SR_${row.spotracId}`, seasons);
      })
  );
  return retained;
}

// Contracts are derived from the cap sheets: a player's consecutive seasons
// with one team at one cap hit form one contract. Expiry status (UFA/RFA)
// comes from the multi-year page's badge in the season after the last one.
function rebuildPlayersAndContracts(data, playerInfo, expiries) {
  const seasonsByKey = new Map();
  data.meta.seasons.forEach((season) => {
    Object.entries(data.capSheets[season] || {}).forEach(([team, sheet]) => {
      sheet.items.forEach((item) => {
        if (item.kind !== "player") return;
        const key = `${team}|${item.playerId}`;
        if (!seasonsByKey.has(key)) seasonsByKey.set(key, []);
        seasonsByKey.get(key).push({ season, item });
      });
    });
  });

  const contracts = [];
  seasonsByKey.forEach((entries, key) => {
    const [team, playerId] = key.split("|");
    let contract = null;
    entries.forEach(({ season, item }) => {
      const aav = item.aav ?? item.capHit;
      if (!contract || seasonAt(contract.startSeason, contract.years) !== season || contract.aav !== aav) {
        contract = { playerId, team, startSeason: season, years: 0, aav, capHits: {}, source: "Spotrac" };
        contracts.push(contract);
      }
      contract.years += 1;
      contract.capHits[season] = item.capHit;
      if (item.clause && !contract.clause) contract.clause = item.clause;
    });
  });
  contracts.forEach((contract) => {
    const end = seasonAt(contract.startSeason, contract.years);
    const expiry = (expiries.get(`${contract.team}|${contract.playerId}`) || []).find((entry) => entry.season === end);
    if (expiry) contract.expiryStatus = expiry.status;
  });
  data.contracts = contracts;

  const existing = new Map((data.players || []).map((player) => [player.id, player]));
  data.players = [...new Set(contracts.map((contract) => contract.playerId))].map((id) => ({
    ...(existing.get(id) || { id, name: id, pos: "", age: 0 }),
    ...(playerInfo.get(id) || {}),
  }));
}

// The "Imported from Spotrac ... on <date>" note changes every run, so it is
// ignored when deciding whether a team's cap sheet actually changed.
function sameCapSheet(a, b) {
  const strip = (sheet) =>
    JSON.stringify({ ...sheet, notes: (sheet.notes || []).filter((note) => !note.startsWith("Imported from Spotrac")) });
  return strip(a) === strip(b);
}

// Spotrac occasionally serves an alternate page (different tables, no
// readable rows); those are refused, so a refused page is fetched once more.
async function withRetry(abbr, scrape) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await scrape();
    } catch (error) {
      if (attempt >= 2) throw error;
      console.warn(`  ${abbr}: ${error.message} — fetching the page again`);
      await sleep(REQUEST_DELAY_MS * 2);
    }
  }
}

function scrapeCapPage(teamSource, season, maxSalary) {
  const abbr = teamSource.abbr;
  return withRetry(abbr, async () => {
    const html = await fetchUrl(capPageUrl(teamSource, season));
    if (DEBUG_ABBR === abbr) dumpMarkup(html, abbr);
    const parsed = parseTeamPage(teamSource, html, season);
    console.log(`${abbr}: ${parsed.sections.map((section) => `${section.title} (${section.count})`).join(", ")}`);
    parsed.unknown.forEach((section) =>
      console.warn(`  ${abbr}: ignored unrecognized section "${section.title}" (${section.count} rows, ${fmtMoney(section.sum)})`)
    );
    const dropped = dropImpossibleCapHits(parsed, maxSalary, abbr);
    checkAgainstSpotracTotals(parsed, dropped);
    return { parsed, dropped };
  });
}

function scrapeYearlyPage(teamSource) {
  return withRetry(teamSource.abbr, async () => {
    const page = parseYearlyPage(await fetchUrl(yearlyPageUrl(teamSource)));
    page.unknown.forEach((id) => console.warn(`  ${teamSource.abbr}: ignored unrecognized multi-year table "${id}"`));
    return page;
  });
}

function writeDataAtomic(data) {
  const tmpPath = `${DATA_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, DATA_PATH); // atomic on the same filesystem
}

function setSheet(sheetsByTeam, abbr, sheet) {
  const prev = sheetsByTeam[abbr];
  if (!prev || !sameCapSheet(prev, sheet)) sheetsByTeam[abbr] = sheet;
}

async function main() {
  if (DEBUG_URLS.length) return dumpPages(DEBUG_URLS);
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const before = JSON.stringify(data);
  // On July 1 the finished season drops off and a new final season is added.
  if ((data.meta.seasons?.[0] || "") < currentSeason()) rollSeasonWindow(data, currentSeason());
  const [season, ...futureSeasons] = data.meta.seasons;
  data.capSheets = data.capSheets || {};
  data.meta.seasons.forEach((s) => (data.capSheets[s] = data.capSheets[s] || {}));
  const maxSalary = (s) => 0.2 * (data.meta.caps?.[s]?.ceiling || Infinity);

  const sources = TARGET_ABBR ? TEAM_SOURCES.filter((teamSource) => teamSource.abbr === TARGET_ABBR) : TEAM_SOURCES;
  if (TARGET_ABBR && sources.length === 0) {
    throw new Error(`Unknown team abbreviation: ${TARGET_ABBR}`);
  }

  const playerInfo = new Map();
  const expiries = new Map();
  const yearlyPages = new Map();
  let ceilings = null;
  let refreshed = 0;
  const failures = [];

  for (let i = 0; i < sources.length; i++) {
    const teamSource = sources[i];
    const abbr = teamSource.abbr;
    // Each page is fetched and parsed before anything is changed, so a failure
    // leaves that team's existing sheets intact.
    try {
      const { parsed, dropped } = await scrapeCapPage(teamSource, season, maxSalary(season));
      setSheet(data.capSheets[season], abbr, buildCapSheet(teamSource, season, parsed, dropped));
      PLAYER_KINDS.forEach((kind) =>
        parsed[kind].forEach((row) => playerInfo.set(`SR_${row.spotracId}`, { name: row.name, pos: row.pos }))
      );
      refreshed++;
    } catch (error) {
      failures.push(`${abbr} ${season}`);
      console.error(`!! ${abbr} ${season} FAILED: ${error.message} (keeping last-known-good cap sheet)`);
    }
    await sleep(REQUEST_DELAY_MS);

    try {
      yearlyPages.set(abbr, await scrapeYearlyPage(teamSource));
    } catch (error) {
      failures.push(`${abbr} multi-year`);
      console.error(`!! ${abbr} multi-year FAILED: ${error.message} (keeping last-known-good future sheets)`);
    }
    if (i < sources.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  // Future sheets need every team's Retained table, so they are built once all
  // multi-year pages are in. A single-team run only sees its own page.
  const retainedElsewhere = retainedByPlayer(yearlyPages);
  sources.forEach((teamSource) => {
    const abbr = teamSource.abbr;
    const page = yearlyPages.get(abbr);
    if (!page) return;
    try {
      const sheets = buildFutureSheets(teamSource, page, futureSeasons, maxSalary, retainedElsewhere);
      futureSeasons.forEach((s) => setSheet(data.capSheets[s], abbr, sheets[s]));
      page.rows.forEach((row) => {
        if (row.kind === "buyout" || row.kind === "retained") return;
        const id = `SR_${row.spotracId}`;
        playerInfo.set(id, { ...playerInfo.get(id), name: row.name, ...(row.pos ? { pos: row.pos } : {}), ...(row.age ? { age: row.age } : {}) });
        if (row.expiries.length) expiries.set(`${abbr}|${id}`, row.expiries);
      });
      ceilings = ceilings || page.summary["Cap Maximum"];
      console.log(
        `${abbr} future: ${futureSeasons
          .filter((s) => sheets[s].items.length)
          .map((s) => `${s} ${fmtMoney(page.summary["Total Cap"]?.[s] || 0)}`)
          .join(", ")}`
      );
      refreshed++;
    } catch (error) {
      failures.push(`${abbr} multi-year`);
      console.error(`!! ${abbr} multi-year FAILED: ${error.message} (keeping last-known-good future sheets)`);
    }
  });

  if (refreshed === 0) {
    throw new Error(`Every page failed — leaving ${path.basename(DATA_PATH)} untouched.`);
  }

  if (ceilings) applyCapCeilings(data.meta, ceilings);
  rebuildPlayersAndContracts(data, playerInfo, expiries);

  const summary = `Refreshed ${refreshed}/${sources.length * 2} pages. Players: ${data.players.length} | Contracts: ${data.contracts.length}`;
  if (JSON.stringify(data) === before) {
    console.log(`\nNo changes from Spotrac — leaving ${path.basename(DATA_PATH)} untouched. ${summary}`);
    if (failures.length) console.log(`Failures (${failures.length}): ${failures.join(", ")}`);
    return;
  }

  if (DRY_RUN) {
    console.log(`\nDry run — not writing ${path.basename(DATA_PATH)}. ${summary}`);
    if (failures.length) console.log(`Failures (${failures.length}): ${failures.join(", ")}`);
    return;
  }

  data.meta.updated = FETCH_DATE;
  data.meta.notes = `Cap data refreshed from Spotrac on ${FETCH_DATE}. Cap ceilings after ${season} are projections.`;
  data.meta.schemaVersion = data.meta.schemaVersion || 2;

  writeDataAtomic(data);

  console.log(`\n${summary}`);
  if (failures.length) console.log(`Failures (${failures.length}): ${failures.join(", ")}`);
}

export {
  buildFutureSheets,
  capTotalsCharges,
  checkAgainstSpotracTotals,
  classifySection,
  dropImpossibleCapHits,
  parsePlayerRows,
  parseTeamPage,
  parseYearlyPage,
  rebuildPlayersAndContracts,
  sameCapSheet,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
