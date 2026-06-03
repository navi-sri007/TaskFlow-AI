// Writes public/config.js from env (Vercel build). Set API_BASE_URL in Vercel project settings.
const fs = require("fs");
const path = require("path");

const apiBase =
  process.env.API_BASE_URL ||
  process.env.VITE_API_BASE_URL ||
  "http://localhost:3000";

const safe = String(apiBase).trim().replace(/\/$/, "").replace(/"/g, '\\"');

const out = path.join(__dirname, "..", "public", "config.js");
fs.writeFileSync(
  out,
  `// Auto-generated — do not edit on Vercel deploys\nwindow.API_BASE_URL = "${safe}";\n`,
);
console.log(`Wrote ${out} with API_BASE_URL=${safe}`);
