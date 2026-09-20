import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    proxy: {
      "/pb-api": {
        target: "https://www.pokebattler.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pb-api/, "/api"),
      },
    },
  },
});
