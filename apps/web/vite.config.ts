import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    // web3.js expects a node-style global in the browser
    global: "globalThis",
  },
  optimizeDeps: {
    // The SDK is a workspace package that changes as often as this app.
    // Pre-bundling it caches a stale copy, and the failure is baffling: a
    // re-export that no longer resolves takes the whole module down, so an
    // unrelated file reports "does not provide an export named WorldScene"
    // instead of naming the SDK. Serve it fresh instead.
    exclude: ["@crossy-world/sdk"],
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
