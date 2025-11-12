import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/main.ts",
  format: ["esm"],
  dts: true,
  outDir: "dist",
  clean: true,
  exports: true,
});
