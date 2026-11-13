import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist/browser",
    emptyOutDir: true,
    lib: {
      entry: "src/plugin.ts",
      formats: ["es"],
      fileName: () => "plugin.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
