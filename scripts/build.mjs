// Build step: bundle and minify the JSX app (with the pinned React from
// node_modules, so the site loads no third-party scripts) and assemble the
// static dist/ folder, including a static page per team and view for search
// engines (see prerender.mjs).
import { build } from "esbuild";
import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { prerenderPages } from "./prerender.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
// The site's public address, used in canonical links and the sitemap.
// Change it (or set SITE_URL) when the site moves to its own domain.
const SITE_URL = (process.env.SITE_URL || "https://nhlcapologist.pages.dev").replace(/\/$/, "");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [resolve(root, "src/app.jsx")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2018"],
  jsx: "transform", // classic runtime -> React.createElement
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: resolve(dist, "app.js"),
  logLevel: "info",
});

cpSync(resolve(root, "data"), resolve(dist, "data"), { recursive: true });

const template = readFileSync(resolve(root, "index.html"), "utf8");
const data = JSON.parse(readFileSync(resolve(root, "data", "nhl-cap-data.json"), "utf8"));
const { pages, sitemap, robots } = prerenderPages(template, data, SITE_URL);
pages.forEach(({ file, html }) => {
  mkdirSync(dirname(resolve(dist, file)), { recursive: true });
  writeFileSync(resolve(dist, file), html);
});
writeFileSync(resolve(dist, "sitemap.xml"), sitemap);
writeFileSync(resolve(dist, "robots.txt"), robots);

console.log(`Build complete -> dist/ (app.js, data/, ${pages.length} pages, sitemap.xml, robots.txt) for ${SITE_URL}`);
