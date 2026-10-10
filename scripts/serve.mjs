// Local server for the built dist/ folder, with the same routing as Cloudflare Pages.
// Usage: npm run serve  (then open http://localhost:3000)
import path from "path";
import { fileURLToPath } from "url";
import { createStaticServer } from "./static-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = process.env.PORT || 3000;

createStaticServer(root).listen(PORT, () => console.log(`Serving dist/ on http://localhost:${PORT}`));
