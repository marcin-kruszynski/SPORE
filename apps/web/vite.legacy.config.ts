import path from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: path.resolve(import.meta.dirname, "src/main.ts"),
      fileName: () => "main.js",
      formats: ["es"],
    },
    outDir: "public",
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name]-[hash][extname]",
        chunkFileNames: "chunks/[name]-[hash].js",
        entryFileNames: "main.js",
        inlineDynamicImports: true,
      },
    },
    sourcemap: false,
  },
  publicDir: false,
});
