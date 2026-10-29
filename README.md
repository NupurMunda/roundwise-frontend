# roundwise-frontend

Plain HTML, CSS and JavaScript front end for [roundwise-backend](https://github.com/NupurMunda/roundwise-backend). No framework, no build step, no runtime dependencies. Deploys to Netlify.

| Page | Route | Data |
|---|---|---|
| Home: company web, search, list | `/` | `/api/v1/graph?limit=60`, `/api/v1/companies` |
| Company | `/c/<slug>` | `/api/v1/companies/<slug>` and its `dsa`, `hld`, `ai`, `behavioral` lists |
| Sources and licenses | `/sources` | `/api/v1/sources` |

The browser only calls same-origin `/api/*`. `netlify/functions/api.mjs` forwards allow-listed GET requests to the backend and adds the API key, so the key never reaches the browser.

## Run locally

1. Start the backend (in `roundwise-backend`): `npm start` (http://127.0.0.1:8787).
2. Copy `.env.example` to `.env` and set `API_BASE_URL=http://127.0.0.1:8787`. Leave `API_KEY` empty for a local backend with no key.
3. `npx netlify-cli dev`, then open http://localhost:8888.

Tests: `npm test` (Node's built-in test runner, no dependencies).

## Deploy to Netlify

1. Push this repo to GitHub.
2. In Netlify: **Add new site** → **Import an existing project** → **GitHub**, and pick the repo.
3. Build command: leave empty. Publish directory: `.`. Functions directory: `netlify/functions` (already set in `netlify.toml`).
4. Under **Site configuration → Environment variables** set `API_BASE_URL` (the backend's worker URL, no trailing path) and `API_KEY`.
5. Deploy. Then set the backend's `ALLOWED_ORIGIN` to the Netlify URL only if the browser ever calls the backend directly; the proxy does not need it.

## Security notes

- CSP, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` are set in `netlify.toml` for every path. There is no inline script, style or `style=""` in the markup.
- API data is rendered with `textContent` and `createElement` only. Links are created only for `https://` URLs, with `rel="noopener noreferrer"`.
- The proxy allows only GET, only the paths in `ALLOWED_PATH`, and only the query params `q`, `page`, `limit`, `time_window`, `difficulty`, `topic`. It never returns upstream headers except `Retry-After`.
- Static assets are cached for a week rather than a year, because file names have no content hash.
- `.env` files are git-ignored; commit only `.env.example`.
