import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    proxy: {
      "/ditto": {
        target: "https://www.dittobase.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ditto/, ""),
      },
    },
  },
});
