import { defineConfig } from "vite";

export default defineConfig({
  root: "webview",
  base: "./",
  build: {
    outDir: "../dist/webview",
    emptyOutDir: true,
  },
});
