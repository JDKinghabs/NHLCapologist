// Minimal static file server for local verification of the built dist/ folder.
// Usage: npm run serve  (then open http://localhost:3000)
import { createServer } from "http";
import { readFile } from "fs";
import { join, extname, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = process.env.PORT || 3000;
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
};

createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const file = join(root, urlPath === "/" ? "/index.html" : urlPath);
  readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "text/plain" });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Serving dist/ on http://localhost:${PORT}`));
