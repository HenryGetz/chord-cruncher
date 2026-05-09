import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/chord-cruncher/",
  plugins: [react()],
  test: {
    exclude: ["node_modules/**", "dist/**", "web-dist/**"],
  },
  build: {
    outDir: "web-dist",
  },
  worker: {
    format: "es",
  },
});
