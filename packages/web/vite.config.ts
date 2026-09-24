import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// 开发时把 /api 代理到后端 8080；生产由后端静态托管 dist
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
