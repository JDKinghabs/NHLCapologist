// Refresh data/nhl-cap-data.json by re-scraping Spotrac cap pages.
//
// It:
//   - rolls the season window forward on July 1 (see season-window.mjs)
//   - throttles + retries the 32 team requests
//   - writes atomically (temp file + rename) so a partial/failed scrape can
//     never corrupt the existing ~1 MB JSON; teams that fail keep their
//     last-known-good cap sheet.
//   - leaves the JSON untouched when Spotrac reports nothing new, so a run
//     never produces a commit that only bumps date stamps.
//
// Usage:
//   node scripts/refresh-data.js            # all 32 teams, current season
//   node scripts/refresh-data.js TOR        # single team
//   SEASON=2027-28 node scripts/refresh-data.js   # another season in the window
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { contractSeasons, currentSeason, rollSeasonWindow } from "./season-window.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, "..", "data", "nhl-cap-data.json");

const SEASON = process.env.SEASON || currentSeason();
const YEAR = Number(process.env.YEAR) || Number(SEASON.slice(0, 4));
const FETCH_DATE = new Date().toISOString().slice(0, 10);
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const TARGET_ABBR = (process.argv[2] || "").toUpperCase();
const DEBUG_ABBR = (process.env.SPOTRAC_DEBUG || "").toUpperCase();
const DEBUG_PLAYER = process.env.SPOTRAC_DEBUG_PLAYER || "";
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

function normalizeName(name) {
  return decodeHtml(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
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

async function fetchSpotracHtml(teamSource) {
  return fetchUrl(`https://www.spotrac.com/nhl/${teamSource.slug}/cap/_/year/${YEAR}`);
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

// Every cap table on a team page sits under a "<SEASON> ..." heading. Each
// match is limited to its own table-header block, so a heading with no table
// can never borrow the next section's rows.
function extractSeasonSections(html) {
  const pattern =
    /<div class="table-header[^"]*">((?:(?!<div class="table-header)[\s\S])*?)<table[^>]*>([\s\S]*?)<\/table>/gi;
  const sections = [];
  let match;
  while ((match = pattern.exec(html))) {
    const h2 = match[1].match(/<h2>([\s\S]*?)<\/h2>/i);
    const heading = h2 ? stripTags(h2[1]) : "";
    if (heading.startsWith(`${SEASON} `)) sections.push({ title: heading.slice(SEASON.length + 1), tableHtml: match[2] });
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
    if (DEBUG_PLAYER) {
      rows.filter((row) => row.includes(DEBUG_PLAYER)).forEach((row) => console.log(`[debug ${abbr}] MATCH ${squash(row)}`));
    }
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

function parseCapTotals(html) {
  const tableHtml = extractTableHtml(html, `${SEASON} Cap Totals`);
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

function parseTeamPage(teamSource, html) {
  const parsed = { sections: [], unknown: [] };
  [...PLAYER_KINDS, ...Object.keys(ADJUSTMENT_KINDS)].forEach((kind) => (parsed[kind] = []));

  extractSeasonSections(html).forEach(({ title, tableHtml }) => {
    const kind = classifySection(title);
    if (kind === "totals") return;
    const rows = parsePlayerRows(tableHtml);
    const sum = rows.reduce((total, row) => total + row.adjustedCap, 0);
    parsed.sections.push({ title, kind, count: rows.length, sum });
    if (kind) parsed[kind].push(...rows);
    else parsed.unknown.push({ title, count: rows.length, sum });
  });

  if (!parsed.sections.some((section) => section.kind === "active")) {
    throw new Error(`Could not find an "${SEASON} Active Roster" section`);
  }
  parsed.totals = parseCapTotals(html);
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

// Players are matched by Spotrac ID; older hand-entered records (TOR_34
// style IDs) by name and position. Spotrac is the source for positions.
function ensurePlayer(data, playerIndex, row) {
  const spotracId = `SR_${row.spotracId}`;
  const key = `${normalizeName(row.name)}|${row.pos}`;
  let player = playerIndex.byId.get(spotracId) || playerIndex.byId.get(playerIndex.byName.get(key));

  if (!player) {
    player = { id: spotracId, name: row.name, pos: row.pos, age: 0 };
    data.players.push(player);
    playerIndex.byId.set(player.id, player);
  }
  if (row.pos && player.pos !== row.pos) player.pos = row.pos;
  playerIndex.byName.set(key, player.id);
  return player.id;
}

function ensureSeasonContract(data, playerId, teamAbbr, row) {
  let contract = (data.contracts || []).find(
    (entry) => entry.playerId === playerId && entry.team === teamAbbr && contractSeasons(entry).includes(SEASON)
  );

  if (!contract) {
    contract = {
      playerId,
      team: teamAbbr,
      type: "UFA",
      startSeason: SEASON,
      years: 1,
      aav: row.totalCap,
      capHits: {
        [SEASON]: row.adjustedCap,
      },
      source: "Spotrac",
    };
    data.contracts.push(contract);
    return contract;
  }

  contract.team = teamAbbr;
  contract.aav = row.totalCap || contract.aav || row.adjustedCap;
  contract.capHits = contract.capHits || {};
  contract.capHits[SEASON] = row.adjustedCap;
  contract.source = "Spotrac";
  return contract;
}

function buildCapSheet(teamSource, parsed, data, playerIndex, dropped) {
  const items = [];
  const adjustments = [];

  PLAYER_KINDS.forEach((category) => {
    parsed[category].forEach((row) => {
      const playerId = ensurePlayer(data, playerIndex, row);
      ensureSeasonContract(data, playerId, teamSource.abbr, row);
      items.push({
        kind: "player",
        playerId,
        category,
        capHit: row.adjustedCap,
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
    `Imported from Spotrac ${SEASON} cap table on ${FETCH_DATE}.`,
    `Source URL: https://www.spotrac.com/nhl/${teamSource.slug}/cap/_/year/${YEAR}`,
    `Sections: ${sectionSummary}.`,
    `Spotrac total allocations=${parsed.totals["Total Allocations"] || "n/a"}; cap space=${parsed.totals["Cap Space"] || "n/a"}.`,
  ];
  dropped.forEach((row) => notes.push(`Skipped ${row.name}: Spotrac cap hit ${fmtMoney(Math.max(row.adjustedCap, row.totalCap))} exceeds the max player salary.`));

  return { status: "complete", items, adjustments, notes };
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
async function scrapeTeam(teamSource, maxSalary) {
  const abbr = teamSource.abbr;
  for (let attempt = 1; ; attempt++) {
    try {
      const html = await fetchSpotracHtml(teamSource);
      if (DEBUG_ABBR === abbr) dumpMarkup(html, abbr);
      const parsed = parseTeamPage(teamSource, html);
      console.log(`${abbr}: ${parsed.sections.map((section) => `${section.title} (${section.count})`).join(", ")}`);
      parsed.unknown.forEach((section) =>
        console.warn(`  ${abbr}: ignored unrecognized section "${section.title}" (${section.count} rows, ${fmtMoney(section.sum)})`)
      );
      const dropped = dropImpossibleCapHits(parsed, maxSalary, abbr);
      checkAgainstSpotracTotals(parsed, dropped);
      return { parsed, dropped };
    } catch (error) {
      if (attempt >= 2) throw error;
      console.warn(`  ${abbr}: ${error.message} — fetching the page again`);
      await sleep(REQUEST_DELAY_MS * 2);
    }
  }
}

function writeDataAtomic(data) {
  const tmpPath = `${DATA_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, DATA_PATH); // atomic on the same filesystem
}

async function main() {
  if (DEBUG_URLS.length) return dumpPages(DEBUG_URLS);
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const before = JSON.stringify(data);
  data.meta = data.meta || {};
  // On July 1 the finished season drops off and a new final season is added.
  if ((data.meta.seasons?.[0] || "") < currentSeason()) rollSeasonWindow(data, currentSeason());
  const seasons = data.meta.seasons || [];
  if (!seasons.includes(SEASON)) {
    throw new Error(`Season ${SEASON} is not in meta.seasons (${seasons.join(", ")}) — add it before refreshing.`);
  }
  data.capSheets = data.capSheets || {};
  data.capSheets[SEASON] = data.capSheets[SEASON] || {};

  const maxSalary = 0.2 * (data.meta.caps?.[SEASON]?.ceiling || Infinity);
  // An older import could add a second record under the same Spotrac ID;
  // keep the one with a real position.
  const byId = new Map();
  (data.players || []).forEach((player) => {
    const prev = byId.get(player.id);
    if (!prev || /^\d+$/.test(prev.pos)) byId.set(player.id, player);
  });
  data.players = [...byId.values()];
  const playerIndex = { byId, byName: new Map() };
  data.players.forEach((player) => playerIndex.byName.set(`${normalizeName(player.name)}|${player.pos}`, player.id));

  const sources = TARGET_ABBR
    ? TEAM_SOURCES.filter((teamSource) => teamSource.abbr === TARGET_ABBR)
    : TEAM_SOURCES;

  if (TARGET_ABBR && sources.length === 0) {
    throw new Error(`Unknown team abbreviation: ${TARGET_ABBR}`);
  }

  const report = [];
  const failures = [];

  for (let i = 0; i < sources.length; i++) {
    const teamSource = sources[i];
    try {
      // Fetch + parse first (no mutation); only commit to `data` once parsing
      // fully succeeds, so a failure leaves this team's prior cap sheet intact.
      const { parsed, dropped } = await scrapeTeam(teamSource, maxSalary);
      const sheet = buildCapSheet(teamSource, parsed, data, playerIndex, dropped);
      const prev = data.capSheets[SEASON][teamSource.abbr];
      if (!prev || !sameCapSheet(prev, sheet)) data.capSheets[SEASON][teamSource.abbr] = sheet;
      report.push({ abbr: teamSource.abbr });
    } catch (error) {
      failures.push({ abbr: teamSource.abbr, message: error.message });
      console.error(`!! ${teamSource.abbr} FAILED: ${error.message} (keeping last-known-good cap sheet)`);
    }
    if (i < sources.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  if (report.length === 0) {
    throw new Error(`All ${sources.length} team(s) failed to refresh — leaving ${path.basename(DATA_PATH)} untouched.`);
  }

  if (JSON.stringify(data) === before) {
    console.log(`\nNo changes from Spotrac for ${SEASON} — leaving ${path.basename(DATA_PATH)} untouched.`);
    if (failures.length) console.log(`Failures (${failures.length}): ${failures.map((f) => f.abbr).join(", ")}`);
    return;
  }

  if (DRY_RUN) {
    console.log(`\nDry run — not writing ${path.basename(DATA_PATH)}.`);
    return;
  }

  data.meta.updated = FETCH_DATE;
  data.meta.notes = `${SEASON} cap sheets refreshed from Spotrac on ${FETCH_DATE}. Future cap figures remain projections.`;
  data.meta.schemaVersion = data.meta.schemaVersion || 2;

  writeDataAtomic(data);

  console.log(`\nRefreshed ${report.length}/${sources.length} teams for ${SEASON}.`);
  if (failures.length) {
    console.log(`Failures (${failures.length}): ${failures.map((f) => f.abbr).join(", ")}`);
  }
  console.log(`Players: ${data.players.length} | Contracts: ${data.contracts.length}`);
}

export {
  capTotalsCharges,
  checkAgainstSpotracTotals,
  classifySection,
  dropImpossibleCapHits,
  parsePlayerRows,
  parseTeamPage,
  sameCapSheet,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
