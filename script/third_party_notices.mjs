import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
let out =
  "Desk95 third-party notices\n\nOriginal Desk95 application source is licensed under MIT; see LICENSE. The following notices accompany bundled third-party components.\n\n";
const inventory = [];
for (const [path, item] of Object.entries(lock.packages)) {
  if (!path || item.dev) continue;
  let files = [];
  try {
    files = await readdir(path);
  } catch {
    continue;
  }
  const licenses = files.filter((n) =>
    /^(licen[cs]e|copying|copyright)(\.|$)/i.test(n),
  );
  const pkg = JSON.parse(await readFile(path + "/package.json", "utf8"));
  inventory.push({
    name: pkg.name,
    version: pkg.version,
    declaredLicense: pkg.license || "Unspecified",
    licenseFiles: licenses,
  });
  out +=
    "\n============================================================\n" +
    pkg.name +
    " " +
    pkg.version +
    "\n" +
    (pkg.repository?.url || pkg.homepage || "") +
    "\n";
  if (!licenses.length) {
    const readme = files.find((f) => /^readme(\.|$)/i.test(f));
    const text = readme ? await readFile(path + "/" + readme, "utf8") : "";
    const i = text.search(/^##? License/im);
    if (i >= 0) {
      out += "\n" + text.slice(i) + "\n";
      inventory.at(-1).licenseFiles = [readme + "#License"];
    } else
      out +=
        "No standalone license file located; package metadata: " +
        JSON.stringify(pkg.license) +
        "\n";
  }
  for (const name of licenses) {
    out +=
      "\n" + name + "\n" + (await readFile(path + "/" + name, "utf8")) + "\n";
  }
}
out +=
  "\n============================================================\nW95FA by Alina Sava / FontsArena\nhttps://fontsarena.com/w95fa-by-alina-sava/\n" +
  (await readFile("public/fonts/w95fa/OFL.txt", "utf8"));
await writeFile("THIRD_PARTY_NOTICES.txt", out);
await mkdir("output/macos", { recursive: true });
await writeFile(
  "output/macos/License_Inventory.json",
  JSON.stringify(inventory, null, 2),
);
console.log(
  JSON.stringify({
    components: inventory.length,
    missingLicenseFiles: inventory
      .filter((x) => !x.licenseFiles.length)
      .map((x) => x.name),
  }),
);
