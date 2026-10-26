import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import JSZip from "jszip";
const [sourcePath, targetPath, reportPath] = process.argv.slice(2);
if (!sourcePath || !targetPath)
  throw new Error(
    "Usage: node script/verify_migration.mjs source.zip target.zip [report.json]",
  );
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function load(path) {
  const bytes = await readFile(path);
  const zip = await JSZip.loadAsync(bytes);
  const s = JSON.parse(await zip.file("workspace.json").async("string")).data;
  const ids = new Map();
  for (const kind of ["projects", "pages", "tasks", "attachments"])
    for (const r of s[kind])
      ids.set(r.id, kind + ":" + r.createdAt + ":" + (r.title || r.name));
  const normalize = (value, key = "") => {
    if (Array.isArray(value)) return value.map((v) => normalize(v, key));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .filter((k) => !["id", "workspaceId"].includes(k))
          .map((k) => [k, normalize(value[k], k)]),
      );
    if (typeof value === "string") {
      if (
        [
          "parentId",
          "projectId",
          "overviewPageId",
          "pageId",
          "pageIds",
          "attachmentId",
        ].includes(key)
      )
        return ids.get(value) || value;
      if (["href", "src"].includes(key))
        return value.replace(
          /(#\/page\/|\/__attachment\/)([A-Za-z0-9_-]+)/g,
          (_, prefix, id) => prefix + (ids.get(id) || id),
        );
    }
    return value;
  };
  const records = {};
  for (const kind of ["projects", "pages", "tasks", "revisions"])
    records[kind] = s[kind]
      .map(normalize)
      .map((v) => JSON.stringify(v))
      .sort();
  records.preferences = s.preferences
    .filter(
      (p) =>
        !["lastLocation", "recent"].includes(p.key) &&
        !p.key.startsWith("nativeMigrationSource:"),
    )
    .map(normalize)
    .map((v) => JSON.stringify(v))
    .sort();
  records.attachments = await Promise.all(
    s.attachments.map(async (a) => ({
      key: ids.get(a.id),
      mime: a.mime,
      size: a.size,
      sha256: hash(await zip.file("attachments/" + a.id).async("nodebuffer")),
    })),
  );
  records.attachments.sort((a, b) => a.key.localeCompare(b.key));
  return { snapshot: s, records, sha256: hash(bytes) };
}
const source = await load(sourcePath),
  target = await load(targetPath);
const checks = {};
for (const key of Object.keys(source.records)) {
  assert.deepEqual(target.records[key], source.records[key], key + " differ");
  checks[key] = {
    matched: true,
    count: source.records[key].length,
    contentDigest: hash(JSON.stringify(source.records[key])),
  };
}
assert.equal(
  target.snapshot.workspace.title.replace(/ \(imported\)$/, ""),
  source.snapshot.workspace.title,
  "Workspace title differs",
);
const report = {
  verified: true,
  sourceSha256: source.sha256,
  targetSha256: target.sha256,
  checks,
  navigationPreferencesExcluded: ["recent", "lastLocation"],
  note: "Import remaps internal identifiers; comparison normalizes only relationships and record identifiers, preserving content and timestamps.",
};
if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
