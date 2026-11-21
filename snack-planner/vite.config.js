import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A fresh id per build. The bundle has it baked in as __BUILD_ID__ and the
// build writes it to version.json, so an open copy of the app can tell when a
// newer version has been deployed (see src/updateCheck.js).
const BUILD_ID = Date.now().toString(36);

const versionFile = {
  name: "version-file",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ id: BUILD_ID }) });
  },
};

export default defineConfig({
  plugins: [react(), versionFile],
  base: "/snack-planner/",
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
});
