import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative base so the built game works from any folder or GitHub Pages.
  base: "./",
  test: {
    // The module cache doesn't notice new files matched by import.meta.glob,
    // so a newly added actor file would be missing from tests until the cache
    // was cleared. Tests are quick without it.
    fsModuleCache: false,
  },
});
