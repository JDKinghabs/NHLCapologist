// Serves dist/ the way Cloudflare Pages does: /teams/TOR is teams/TOR.html,
// a folder serves its index.html, and any other path gets index.html so the
// app can route it (Pages does this when a project has no 404.html).
import { createServer } from "http";
import fs from "fs";
import path from "path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

export function resolveFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    decoded = "/";
  }
  const target = path.join(root, decoded);
  if (!target.startsWith(root)) return path.join(root, "index.html");
  const candidates = [target, `${target}.html`, path.join(target, "index.html")];
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) || path.join(root, "index.html");
}

export function createStaticServer(root) {
  return createServer((req, res) => {
    const file = resolveFile(root, req.url);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}
