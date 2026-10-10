// Static HTML for search engines and link previews: a page per team, one per
// view, a home page linking every team, plus sitemap.xml and robots.txt.
// Each page is index.html with its own title, description and canonical URL,
// and a plain summary inside #root that the app replaces when it loads.
// Figures come from the site's own cap math (src/cap-math.js).
import { buildTeamData } from "../src/cap-math.js";
import { pageTitle, routePath } from "../src/routes.js";

const fmtM = (amount) => `${amount < 0 ? "-" : ""}$${(Math.abs(amount) / 1e6).toFixed(2)}M`;
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const VIEW_COPY = {
  standings: ["NHL standings and payrolls", "Every team's record next to its payroll and cap space."],
  trade: ["NHL trade cap checker", "Check a trade against the salary cap, the 50-contract limit and retained-salary rules."],
  projections: ["NHL salary cap projections", "Each team's committed cap money and pending free agents for every season ahead."],
};

function fillTemplate(template, { title, description, url, body }) {
  const replacements = [
    [/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`],
    [/<meta name="description" content="[^"]*"\/>/, `<meta name="description" content="${escapeHtml(description)}"/>`],
    [/<meta property="og:title" content="[^"]*"\/>/, `<meta property="og:title" content="${escapeHtml(title)}"/>`],
    [/<meta property="og:description" content="[^"]*"\/>/, `<meta property="og:description" content="${escapeHtml(description)}"/>`],
    [/<meta property="og:type" content="website"\/>/, (tag) => (url ? `${tag}\n<link rel="canonical" href="${url}"/>\n<meta property="og:url" content="${url}"/>` : tag)],
    [/<div id="root"><\/div>/, `<div id="root">${body}</div>`],
  ];
  return replacements.reduce((html, [pattern, value]) => {
    if (!pattern.test(html)) throw new Error(`index.html is missing ${pattern}`);
    return html.replace(pattern, typeof value === "function" ? value : () => value);
  }, template);
}

export function prerenderPages(template, data, siteUrl) {
  const season = data.meta.seasons[0];
  const lastSeason = data.meta.seasons[data.meta.seasons.length - 1];
  const ceiling = data.meta.caps[season].ceiling;
  const teams = buildTeamData(data, season, ceiling).sort((a, b) => a.name.localeCompare(b.name));
  const route = (view, team = null) => ({ season, view, team });
  const pathOf = (r) => routePath(r, season);
  const pages = [];

  const teamList = teams
    .map((t) => `<li><a href="${pathOf(route("dashboard", t.abbr))}">${escapeHtml(t.name)}</a>: ${fmtM(t.payroll)} payroll, ${fmtM(t.space)} cap space</li>`)
    .join("");
  // index.html is also what Pages serves for paths without their own page, so it gets no canonical URL.
  pages.push({
    file: "index.html",
    html: fillTemplate(template, {
      title: pageTitle(route("dashboard")),
      description: `Every NHL team's ${season} salary cap: payrolls, cap space and contracts by season, standings with payrolls, a trade checker and cap projections through ${lastSeason}.`,
      body: `<main class="prerender"><h1>NHL salary cap tracker, ${season}</h1><p>Cap ceiling ${fmtM(ceiling)}.</p><ul>${teamList}</ul></main>`,
    }),
  });

  Object.entries(VIEW_COPY).forEach(([view, [heading, blurb]]) => {
    pages.push({
      file: `${view}.html`,
      html: fillTemplate(template, {
        title: pageTitle(route(view)),
        description: `${blurb} ${season} season.`,
        url: siteUrl + pathOf(route(view)),
        body: `<main class="prerender"><h1>${heading}, ${season}</h1><p>${blurb}</p><p><a href="/">All 32 NHL teams</a></p></main>`,
      }),
    });
  });

  teams.forEach((t) => {
    const rows = t.roster
      .slice(0, 10)
      .map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.pos)}</td><td>${fmtM(p.capHit)}</td><td>${p.years}</td></tr>`)
      .join("");
    pages.push({
      file: `teams/${t.abbr}.html`,
      html: fillTemplate(template, {
        title: pageTitle(route("dashboard", t.abbr), t.name),
        description: `${t.name} ${season} salary cap: ${fmtM(t.payroll)} payroll and ${fmtM(t.space)} in cap space against the ${fmtM(ceiling)} ceiling. Every player's cap hit and contract through ${lastSeason}.`,
        url: siteUrl + pathOf(route("dashboard", t.abbr)),
        body:
          `<main class="prerender"><h1>${escapeHtml(t.name)} salary cap, ${season}</h1>` +
          `<p>Payroll ${fmtM(t.payroll)} · Cap space ${fmtM(t.space)} · Ceiling ${fmtM(ceiling)} · ${t.roster.length} players counting against the cap</p>` +
          `<table><caption>Largest cap hits</caption><thead><tr><th>Player</th><th>Pos</th><th>Cap hit</th><th>Years left</th></tr></thead><tbody>${rows}</tbody></table>` +
          `<p><a href="/">All 32 NHL teams</a> · <a href="/projections">Cap projections</a></p></main>`,
      }),
    });
  });

  const paths = ["/", ...Object.keys(VIEW_COPY).map((view) => pathOf(route(view))), ...teams.map((t) => pathOf(route("dashboard", t.abbr)))];
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((p) => `  <url><loc>${siteUrl}${p}</loc><lastmod>${data.meta.updated}</lastmod></url>\n`).join("") +
    `</urlset>\n`;
  const robots = `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
  return { pages, sitemap, robots };
}
