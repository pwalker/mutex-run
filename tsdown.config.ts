import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/main.ts",
  format: ["esm"],
  dts: true,
  outDir: "dist",
  clean: true,
  exports: true,
  shims: false, // Don't add Node.js shims for executables
});
