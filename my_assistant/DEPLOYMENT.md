# Deploy: Vercel (frontend) + Render (backend)

## What was wrong

The frontend used `import.meta.env.VITE_API_BASE_URL`, which only works with a **Vite build**. Your app loads plain `script.js` in the browser, so the API URL was `undefined` and requests failed (e.g. `undefined/api/chat`).

## Architecture

| Platform | Serves | Root directory |
|----------|--------|----------------|
| **Vercel** | `public/` (HTML, CSS, JS) | `my_assistant` |
| **Render** | Express API (`server.js`) | `my_assistant` |

## Render (backend)

1. New **Web Service** → connect repo → **Root Directory**: `my_assistant`
2. **Build command**: `npm install`
3. **Start command**: `npm start`
4. **Environment variables**:
   - `GROQ_API_KEY`
   - `MONGODB_URL` — use **MongoDB Atlas**, not `localhost`
   - `FRONTEND_URL` — your Vercel URL, e.g. `https://your-app.vercel.app`
5. Copy the service URL, e.g. `https://taskflow-api.onrender.com`
6. Test: open `https://YOUR-SERVICE.onrender.com/api/health` → should return `{"ok":true,...}`

## Vercel (frontend)

1. Import project → **Root Directory**: `my_assistant`
2. Vercel reads `vercel.json` and runs `node scripts/generate-config.js` before deploy
3. **Environment variable** (Production):
   - `API_BASE_URL` = your Render URL, e.g. `https://taskflow-api.onrender.com` (no trailing slash)
4. Redeploy after saving env vars

## Local development

1. Backend: `npm start` in `my_assistant` (port 3000)
2. Frontend: open `http://localhost:3000` (Express serves `public/`)  
   Or open `public/index.html` via Live Server — `config.js` defaults to `http://localhost:3000`

## Checklist if it still fails

- [ ] Browser DevTools → Network: requests go to `https://....onrender.com/api/...`, not `undefined/api/...`
- [ ] Render logs: MongoDB connected (Atlas IP allowlist includes `0.0.0.0/0` for testing)
- [ ] `FRONTEND_URL` on Render matches your exact Vercel URL (https, no trailing slash)
- [ ] CORS error in console → fix `FRONTEND_URL` on Render and redeploy backend
