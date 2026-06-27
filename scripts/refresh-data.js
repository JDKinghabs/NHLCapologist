// Refresh data/nhl-cap-data.json by re-scraping Spotrac cap pages.
//
// Cloud/Linux-portable port of import-spotrac-cap-sheets.js:
//   - uses Node's global fetch() instead of shelling out to curl.exe
//   - resolves the data file relative to the repo (no hardcoded C:/ path)
//   - throttles + retries the 32 team requests
//   - writes atomically (temp file + rename) so a partial/failed scrape can
//     never corrupt the existing ~1 MB JSON; teams that fail keep their
//     last-known-good cap sheet.
//
// Usage:
//   node scripts/refresh-data.js            # all 32 teams
//   node scripts/refresh-data.js TOR        # single team
//   SEASON=2026-27 node scripts/refresh-data.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(__dirname, "..", "data", "nhl-cap-data.json");

const SEASON = process.env.SEASON || "2025-26";
const YEAR = Number(process.env.YEAR) || Number(SEASON.slice(0, 4));
const FETCH_DATE = new Date().toISOString().slice(0, 10);
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const TARGET_ABBR = (process.argv[2] || "").toUpperCase();

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

function buildSeasonList(startSeason, years, seasons) {
  if (!startSeason || !years) return [];
  const idx = seasons.indexOf(startSeason);
  if (idx === -1) return [];
  return seasons.slice(idx, idx + years);
}

function isActiveSeason(contract, season, seasons) {
  return buildSeasonList(contract.startSeason, contract.years, seasons).includes(season);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSpotracHtml(teamSource) {
  const url = `https://www.spotrac.com/nhl/${teamSource.slug}/cap/_/year/${YEAR}`;
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

function extractOptionalTableHtml(html, headingText) {
  try {
    return extractTableHtml(html, headingText);
  } catch (error) {
    return "";
  }
}

function extractTbody(tableHtml) {
  const match = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  return match ? match[1] : "";
}

function parsePlayerRows(tableHtml) {
  const tbody = extractTbody(tableHtml);
  const rows = [];
  const rowPattern = /<tr class="[^"]*">([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(tbody))) {
    const rowHtml = rowMatch[1];
    const playerMatch = rowHtml.match(/player\/_\/id\/(\d+)\/[^"]+" class="link[^"]*"[^>]*>([^<]+)<\/a>/i);
    if (!playerMatch) continue;

    let pos = "";
    let totalCap = 0;
    let adjustedCap = 0;
    const dataSorts = Array.from(rowHtml.matchAll(/<td[^>]*data-sort="([^"]*)"[^>]*>/gi)).map((match) => match[1]);

    if (dataSorts.length >= 3) {
      pos = decodeHtml(dataSorts[0]);
      totalCap = safeNum(dataSorts[1]);
      adjustedCap = safeNum(dataSorts[2]);
    } else {
      const tdMatches = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((match) => stripTags(match[1]));
      if (tdMatches.length < 4) continue;
      pos = tdMatches[1];
      totalCap = parseMoneyText(tdMatches[2]);
      adjustedCap = parseMoneyText(tdMatches[3]);
    }

    rows.push({
      spotracId: playerMatch[1],
      name: decodeHtml(playerMatch[2]),
      pos,
      totalCap,
      adjustedCap,
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

function parseTeamPage(teamSource, html) {
  const active = parsePlayerRows(extractTableHtml(html, `${SEASON} Active Roster Cap`));
  const buyout = parsePlayerRows(extractOptionalTableHtml(html, `${SEASON} Buyout Cap`));
  const retained = parsePlayerRows(extractOptionalTableHtml(html, `${SEASON} Retained Cap`));
  const minor = parsePlayerRows(extractOptionalTableHtml(html, `${SEASON} Minor`));
  const totals = parseCapTotals(html);

  return { active, buyout, retained, minor, totals };
}

function ensurePlayer(data, playerIndex, row) {
  const key = `${normalizeName(row.name)}|${row.pos}`;
  let playerId = playerIndex.get(key);
  if (playerId) return playerId;

  playerId = `SR_${row.spotracId}`;
  data.players.push({
    id: playerId,
    name: row.name,
    pos: row.pos,
    age: 0,
  });
  playerIndex.set(key, playerId);
  return playerId;
}

function ensureSeasonContract(data, playerId, teamAbbr, row) {
  const seasons = data.meta?.seasons || [];
  let contract = (data.contracts || []).find(
    (entry) => entry.playerId === playerId && entry.team === teamAbbr && isActiveSeason(entry, SEASON, seasons)
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

function buildCapSheet(teamSource, parsed, data, playerIndex) {
  const items = [];
  const adjustments = [];

  parsed.active.forEach((row) => {
    const playerId = ensurePlayer(data, playerIndex, row);
    ensureSeasonContract(data, playerId, teamSource.abbr, row);
    items.push({
      kind: "player",
      playerId,
      category: "active",
      capHit: row.adjustedCap,
    });
  });

  parsed.minor.forEach((row) => {
    const playerId = ensurePlayer(data, playerIndex, row);
    ensureSeasonContract(data, playerId, teamSource.abbr, row);
    items.push({
      kind: "player",
      playerId,
      category: "minors",
      capHit: row.adjustedCap,
      notes: row.buried ? ["Buried"] : [],
    });
  });

  parsed.buyout.forEach((row, idx) => {
    adjustments.push({
      id: `${teamSource.abbr}-buyout-${idx + 1}`,
      label: row.name,
      category: "buyout",
      amount: row.adjustedCap,
      notes: row.waived ? "Waived / buyout charge from Spotrac" : "Buyout charge from Spotrac",
    });
  });

  parsed.retained.forEach((row, idx) => {
    adjustments.push({
      id: `${teamSource.abbr}-retained-${idx + 1}`,
      label: row.name,
      category: "retainedSalary",
      amount: row.adjustedCap,
      notes: "Retained salary charge from Spotrac",
    });
  });

  const activeAdjusted = parsed.active.reduce((sum, row) => sum + row.adjustedCap, 0);
  const minorAdjusted = parsed.minor.reduce((sum, row) => sum + row.adjustedCap, 0);
  const buyoutAdjusted = parsed.buyout.reduce((sum, row) => sum + row.adjustedCap, 0);
  const retainedAdjusted = parsed.retained.reduce((sum, row) => sum + row.adjustedCap, 0);

  return {
    status: "complete",
    items,
    adjustments,
    notes: [
      `Imported from Spotrac ${SEASON} cap table on ${FETCH_DATE}.`,
      `Source URL: https://www.spotrac.com/nhl/${teamSource.slug}/cap/_/year/${YEAR}`,
      `Active adjusted=${activeAdjusted}; minor adjusted=${minorAdjusted}; buyout adjusted=${buyoutAdjusted}; retained adjusted=${retainedAdjusted}.`,
      `Spotrac total allocations=${parsed.totals["Total Allocations"] || "n/a"}; cap space=${parsed.totals["Cap Space"] || "n/a"}.`,
    ],
  };
}

function writeDataAtomic(data) {
  const tmpPath = `${DATA_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, DATA_PATH); // atomic on the same filesystem
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  data.capSheets = data.capSheets || {};
  data.capSheets[SEASON] = data.capSheets[SEASON] || {};
  data.meta = data.meta || {};

  const playerIndex = new Map();
  (data.players || []).forEach((player) => {
    playerIndex.set(`${normalizeName(player.name)}|${player.pos}`, player.id);
  });

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
      const html = await fetchSpotracHtml(teamSource);
      const parsed = parseTeamPage(teamSource, html);
      data.capSheets[SEASON][teamSource.abbr] = buildCapSheet(teamSource, parsed, data, playerIndex);
      report.push({
        abbr: teamSource.abbr,
        active: parsed.active.length,
        minor: parsed.minor.length,
        buyout: parsed.buyout.length,
        retained: parsed.retained.length,
      });
      console.log(
        `${teamSource.abbr}: active=${parsed.active.length}, minor=${parsed.minor.length}, buyout=${parsed.buyout.length}, retained=${parsed.retained.length}`
      );
    } catch (error) {
      failures.push({ abbr: teamSource.abbr, message: error.message });
      console.error(`!! ${teamSource.abbr} FAILED: ${error.message} (keeping last-known-good cap sheet)`);
    }
    if (i < sources.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  if (report.length === 0) {
    throw new Error(`All ${sources.length} team(s) failed to refresh — leaving ${path.basename(DATA_PATH)} untouched.`);
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

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
