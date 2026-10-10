import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { escapeHtml, prerenderPages } from "../scripts/prerender.mjs";

const template = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const data = JSON.parse(fs.readFileSync(new URL("../data/nhl-cap-data.json", import.meta.url), "utf8"));
const { pages, sitemap, robots } = prerenderPages(template, data, "https://example.com");
const page = (file) => pages.find((p) => p.file === file).html;

test("writes the home page, three views and a page per team", () => {
  assert.equal(pages.length, 4 + data.teams.length);
  data.teams.forEach((team) => assert.ok(pages.some((p) => p.file === `teams/${team.abbr}.html`), team.abbr));
});

test("team pages have their own title, description, canonical link and summary", () => {
  const tor = page("teams/TOR.html");
  assert.match(tor, /<title>Toronto Maple Leafs Salary Cap \d{4}-\d{2} · IceCap<\/title>/);
  assert.match(tor, /<meta name="description" content="Toronto Maple Leafs \d{4}-\d{2} salary cap: \$/);
  assert.match(tor, /<link rel="canonical" href="https:\/\/example.com\/teams\/TOR"\/>/);
  assert.match(tor, /<div id="root"><main class="prerender">.*<table>/);
});

test("the home page links every team but has no canonical link, since it also serves unknown paths", () => {
  const home = page("index.html");
  assert.ok(!home.includes('rel="canonical"'));
  assert.equal((home.match(/<a href="\/teams\/[A-Z]{3}">/g) || []).length, data.teams.length);
});

test("sitemap and robots.txt point at the site URL", () => {
  assert.equal((sitemap.match(/<loc>/g) || []).length, 4 + data.teams.length);
  assert.ok(sitemap.includes("<loc>https://example.com/teams/TOR</loc>"));
  assert.ok(robots.includes("Sitemap: https://example.com/sitemap.xml"));
});

test("text is escaped and a template missing a tag fails the build", () => {
  assert.equal(escapeHtml(`Ryan O'Reilly <C> & "co"`), "Ryan O&#39;Reilly &lt;C&gt; &amp; &quot;co&quot;");
  assert.throws(() => prerenderPages(template.replace('<div id="root"></div>', ""), data, "https://example.com"), /missing/);
});
