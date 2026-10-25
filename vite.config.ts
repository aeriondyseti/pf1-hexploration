import { defineConfig } from "vite";

// Foundry loads dist/ as the module root: dist/main.js plus everything in static/
// (module.json, styles) copied verbatim.
export default defineConfig({
  publicDir: "static",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: "es2022",
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
