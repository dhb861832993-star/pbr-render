/**
 * Local static + proxy server for the PBRRender browser test.
 * - /test-page.html  -> serves test-page.html from the plugin dir
 * - /plugins/*       -> proxies to http://127.0.0.1:3080 (the live dsh web)
 * Run: node scripts/test-server.mjs  (then Chrome headless against :3456)
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = "http://127.0.0.1:3080";
const PORT = 3456;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname === "/" || url.pathname === "/test-page.html") {
    try {
      const body = await readFile(join(root, "test-page.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
      return;
    } catch {
      res.writeHead(404); res.end("no test page"); return;
    }
  }
  if (url.pathname.startsWith("/plugins/")) {
    const upstream = TARGET + url.pathname + url.search;
    const headers = { ...req.headers, host: new URL(TARGET).host };
    const preq = await fetch(upstream, { method: req.method, headers, body: ["GET","HEAD"].includes(req.method) ? undefined : req });
    const body = Buffer.from(await preq.arrayBuffer());
    res.writeHead(preq.status, Object.fromEntries(preq.headers));
    res.end(body);
    return;
  }
  res.writeHead(404); res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`test server on http://127.0.0.1:${PORT}/test-page.html`);
});
