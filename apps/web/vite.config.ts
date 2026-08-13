import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    // web3.js expects a node-style global in the browser
    global: "globalThis",
  },
  server: {
    // Dev server is reached through proxy hostnames (e.g. test.mystic.cat).
    allowedHosts: true,
    proxy: {
      // The Magic Router doesn't send CORS headers; same-origin proxy.
      "/magic-router": {
        target: "https://devnet-router.magicblock.app",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/magic-router/, ""),
      },
    },
  },
});
