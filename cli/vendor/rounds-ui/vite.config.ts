import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Static Rounds UI only. Never load its standalone Claude API plugin. */
export default defineConfig({
  base: "/work/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist/work-canvas", emptyOutDir: true },
});
