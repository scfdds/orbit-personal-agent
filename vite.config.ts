import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${process.env.ORBIT_PORT || 4330}` },
  },
  build: {
    outDir: "dist",
    // AudioWorklet modules are executable code. Keep them same-origin so the
    // desktop's script-src 'self' policy can remain narrow (no data: scripts).
    assetsInlineLimit: filePath => filePath.endsWith("voice-pcm-worklet.js") ? false : undefined,
  },
});
