import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const rendererRoot = resolve("src/renderer");

export default defineConfig({
  root: rendererRoot,
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve("dist/renderer"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(rendererRoot, "index.html"),
        overlay: resolve(rendererRoot, "overlay.html"),
      },
    },
  },
});
