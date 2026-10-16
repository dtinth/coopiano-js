import { defineConfig } from "vite-plus";

export default defineConfig({
  // Relative URLs, so the build works from any path (GitHub Pages, a subfolder, a WAM host
  // loading wam/index.js from another origin).
  base: "./",
  build: {
    target: "es2022",
    rolldownOptions: {
      input: {
        index: "index.html",
        "wam-host": "wam-host.html",
        wam: "src/wam/index.ts",
      },
      // Keep the WAM entry's default export; app builds drop entry exports otherwise.
      preserveEntrySignatures: "exports-only",
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "wam" ? "wam/index.js" : "assets/[name]-[hash].js",
      },
    },
  },
  worker: { format: "es" },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
