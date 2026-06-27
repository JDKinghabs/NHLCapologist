// Build step: transpile/minify the JSX app and assemble the static dist/ folder.
// React + ReactDOM are loaded as CDN globals in index.html, so the app references
// the global `React` / `ReactDOM` — esbuild only needs to transform JSX, no bundling
// of React itself.
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
  jsx: "transform", // classic runtime -> React.createElement (global React)
  outfile: resolve(dist, "app.js"),
  logLevel: "info",
});

copyFileSync(resolve(root, "index.html"), resolve(dist, "index.html"));
cpSync(resolve(root, "data"), resolve(dist, "data"), { recursive: true });

console.log("Build complete -> dist/ (index.html, app.js, data/)");
