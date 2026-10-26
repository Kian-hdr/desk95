import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "output/native-web",
    emptyOutDir: true,
    lib: {
      entry: "src/main.tsx",
      name: "Desk95",
      formats: ["iife"],
      fileName: () => "assets/desk95.js",
      cssFileName: "desk95",
    },
    cssCodeSplit: false,
  },
});
