import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const files = await readdir("dist", { recursive: true });
const assets = [];
const hash = createHash("sha256");
for (const path of files) {
  if (path === "sw.js" || !path.includes(".")) continue;
  try {
    const bytes = await readFile("dist/" + path);
    assets.push("/" + path);
    hash.update(bytes);
  } catch {}
}
const version = "desk95-" + hash.digest("hex").slice(0, 12);
const source = `const CACHE=${JSON.stringify(version)};const ASSETS=${JSON.stringify(["/", ...assets])};
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('desk95-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/').then(r=>r||Response.error())));return}e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)))});`;
await writeFile("dist/sw.js", source);
console.log("Offline cache: " + version + " (" + assets.length + " files)");
