import { readFile, writeFile, readdir } from "node:fs/promises";
const files = await readdir("output/native-web", { recursive: true });
const css = files.find((f) => f.endsWith(".css"));
if (!css) throw new Error("Native stylesheet is missing");
let html = await readFile("index.html", "utf8");
html = html.replace(
  /<script type="module"[^>]+src="\/src\/main.tsx"[^>]*><\/script>/,
  '<script defer src="./assets/desk95.js"></script>',
);
html = html.replaceAll('href="/', 'href="./');
html = html.replace(
  "</head>",
  `<link rel="stylesheet" href="./${css}"></head>`,
);
html = html.replace(
  "<head>",
  `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self' file:; script-src 'self' file: 'unsafe-inline'; style-src 'self' file: 'unsafe-inline'; img-src 'self' file: blob: data:; font-src 'self' file:; connect-src file: blob:; object-src 'none'; base-uri 'none'; form-action 'none'">`,
);
const stylesheet = await readFile("output/native-web/" + css, "utf8");
if (!css.includes("/"))
  await writeFile(
    "output/native-web/" + css,
    stylesheet.replaceAll("url(../fonts/", "url(./fonts/"),
  );
await writeFile("output/native-web/index.html", html);
