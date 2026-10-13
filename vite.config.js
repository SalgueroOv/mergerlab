import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Rutas relativas: el index.html se carga con file:// dentro de Electron.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        about: resolve(__dirname, "src/about.html"),
      },
    },
  },
  test: {
    include: ["src/**/*.test.{js,jsx}"],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
