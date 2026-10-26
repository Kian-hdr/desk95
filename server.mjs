import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve(import.meta.dirname, "dist");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = http.createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (name === "/__desk95_health") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ app: "Desk95" }));
      return;
    }
    let path = resolve(root, "." + name);
    if (!path.startsWith(root + sep) && path !== root) {
      res.writeHead(403).end();
      return;
    }
    if (name === "/" || (await stat(path).catch(() => null))?.isDirectory())
      path = resolve(root, "index.html");
    let bytes;
    try {
      bytes = await readFile(path);
    } catch {
      if (!extname(name)) {
        path = resolve(root, "index.html");
        bytes = await readFile(path);
      } else {
        res.writeHead(404).end();
        return;
      }
    }
    res.writeHead(200, {
      "Content-Type": mime[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    res.end(bytes);
  } catch {
    res.writeHead(500).end("Unable to serve Desk95");
  }
});
server.listen(9595, "127.0.0.1", () =>
  console.log("Desk95 is available at http://127.0.0.1:9595"),
);
server.on("error", (err) => {
  console.error(
    err.code === "EADDRINUSE"
      ? "Port 9595 is already in use. Open http://127.0.0.1:9595 or stop the conflicting service."
      : err.message,
  );
  process.exitCode = 1;
});
