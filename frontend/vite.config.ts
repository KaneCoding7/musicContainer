import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

// Dev only: Vite blocks requests whose Host header isn't in this list. When the
// dev server is reached through a tunnel/proxy (e.g. Cloudflare), set
// VITE_ALLOWED_HOSTS to a comma-separated list of public hostnames.
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    allowedHosts,
  },
});
