// Build step: bundle and minify the JSX app (with the pinned React from
// node_modules, so the site loads no third-party scripts) and assemble the
// static dist/ folder.
import { build } from "esbuild";
import { rmSync, mkdirSync, copyFileSync, cpSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

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

copyFileSync(resolve(root, "index.html"), resolve(dist, "index.html"));
cpSync(resolve(root, "data"), resolve(dist, "data"), { recursive: true });

console.log("Build complete -> dist/ (index.html, app.js, data/)");
