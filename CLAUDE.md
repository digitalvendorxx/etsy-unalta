# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.

## Output
- Return code first. Explanation after, only if non-obvious.
- No inline prose. Use comments sparingly - only where logic is unclear.
- No boilerplate unless explicitly requested.

## Code Rules
- Simplest working solution. No over-engineering.
- No abstractions for single-use operations.
- No speculative features or "you might also want..."
- Read the file before modifying it. Never edit blind.
- No docstrings or type annotations on code not being changed.
- No error handling for scenarios that cannot happen.
- Three similar lines is better than a premature abstraction.

## Review Rules
- State the bug. Show the fix. Stop.
- No suggestions beyond the scope of the review.
- No compliments on the code before or after the review.

## Debugging Rules
- Never speculate about a bug without reading the relevant code first.
- State what you found, where, and the fix. One pass.
- If cause is unclear: say so. Do not guess.

## Simple Formatting
- No em dashes, smart quotes, or decorative Unicode symbols.
- Plain hyphens and straight quotes only.
- Natural language characters (accented letters, CJK, etc.) are fine when the content requires them.
- Code output must be copy-paste safe.

## Commands

```bash
npm install                         # install deps (incl. playwright, sharp, better-sqlite3)
npx playwright install chromium     # required once for Playwright (if using launched browser paths)

npm run browser                     # launch user's browser with CDP on config.cdpPort
npm start                           # run Express server (default :3000)
npm run dev                         # launch-browser then start server (sequential, not parallel)
npm run create -- --ref <img> --mockups <m1,m2> --competitor <url> --sku <id>   # CLI pipeline

pm2 start ecosystem.config.js       # production (logs to ./logs/, auto-restart)
```

No test suite, no linter configured. "Testing" means running the pipeline end-to-end against the live Etsy/Pinterest UI via CDP.

## Required Config

Two files the repo won't boot without (both gitignored):

- `.env` — `GEMINI_API_KEY` (design generation), `OPENROUTER_API_KEY` (SEO/tags via LLM). Optional `JWT_SECRET` (else a random one is generated per process, invalidating existing tokens on restart), `PORT`.
- `config.json` — copy from `config.example.json`. `operaPath` (absolute path to the user's Chromium-based browser binary), `cdpPort`, default mockup placement rect (`x/y/width/height`), `keepPhotoIndexes`/`keepPhotoCount`.

`mockup-positions.json` (auto-created, gitignored) stores per-template placement overrides edited from the UI. `data/app.db` is the SQLite store (auto-created, WAL mode). `data/cookies.json` holds global Etsy/Pinterest session cookies.

## Architecture

Two entry points share the `lib/` pipeline:

- `create.js` — headless CLI, 5 fixed steps: generate design → compose mockups → scrape tags → upload → pin.
- `server.js` — Express 5 app (~1000 lines). Serves `public/index.html` SPA, streams the pipeline over SSE at `POST /api/create`, and exposes granular endpoints (`/api/generate-tags-ai`, `/api/regenerate-mockup`, `/api/mockup-positions`, `/api/cdp-status`, `/api/cdp-launch`, etc.).

### Pipeline (`lib/`)

1. `generate-design.js` — `generateDesign` (Google `@google/genai` Imagen/Gemini) and `generateDesignFlux` (OpenRouter Flux). Output PNG to `designs/`.
2. `compose-mockup.js` — Sharp-based compositor. Four variants: `composeMockup` (default), `composeMockupSharp`, `composeMockupFlux`, `composeMockupCopyrighted`. Uses `@imgly/background-removal-node` for transparency. Placement comes from `mockup-positions.json` with fallback to `config.json`. Outputs to `output/`.
3. `scrape-tags.js` — Playwright scraper over CDP; `generateSEOTitle` post-processes via OpenRouter.
4. `upload-etsy.js` — Playwright CDP driver. Two paths: SKU match → `copyFromListingManager` (duplicate existing draft), or creates a new listing. Handles photos, title, description, tags, publish. `upload-etsy-cookies.js` is an alternate path that `chromium.launch({headless:true})` + cookie injection (not CDP).
5. `pin-to-pinterest.js` / `pin-to-pinterest-cookies.js` — parallel pattern for Pinterest.
6. `optimize.js` — large prompt-builder for LLM-generated Etsy titles/descriptions with embedded product copy (styles, sizing, colors) consumed by `/api/generate-*-ai`.

### Browser automation model

Uploads and tag scraping expect a real Chromium-based browser (Opera GX in the example config) already running with `--remote-debugging-port=<cdpPort>`. `launch-browser.js` and `POST /api/cdp-launch` spawn it; `lib/upload-etsy.js::connectBrowser` retries CDP connect for up to 30s. The `-cookies.js` variants bypass CDP entirely and launch a fresh headless browser with stored cookies — use them for background/unattended flows. Never trigger `alert/confirm/prompt` dialogs while a CDP session is attached; they freeze Playwright.

### SSE pipeline contract (`POST /api/create`)

Multipart form: `ref`, optional `backDesign`, `mockups[]`. Body fields drive the flow:

- `mode`: `single | front-back | copyrighted`.
- `libraryMockups`: comma-separated `/mockups/<file>` paths reused from the mockup library (`mockups/` dir served statically).
- `resumeFrom` / `continueFrom` + `existingDesign` / `existingMockups` / `existingTags` / `existingTitle` / `existingDescription` / `existingListingUrl`: skip earlier stages. Step order: `generate → mockup → tags → upload → pinterest`.
- `fullAuto=1`: end-to-end without manual approval; otherwise the UI waits for mockup approval (`continueFrom: mockup-approve` → jumps to `tags`).

Emits `data: {type, message, ...}` events per step; keepalive every 15s. Never close the stream without `res.end()`.

### Auth is scaffolded but not wired

`lib/database.js` defines `users`/`usage` tables with `free|basic|pro` plan limits, and `lib/auth.js` exports `authMiddleware` + `setupAuthRoutes` (JWT, bcrypt, `/api/auth/{signup,login,me,etsy-cookies,pinterest-cookies}`). **Neither is required or mounted in `server.js`** — the server is effectively single-tenant, storing Etsy/Pinterest cookies in `data/cookies.json` and gating nothing. `public/login.html` exists but is unreachable through normal routing. Treat this as dead-but-kept infrastructure: do not assume `req.user` anywhere, and do not add per-user checks without also wiring `setupAuthRoutes(app)` + `app.use(authMiddleware)` first.

### Runtime directories (auto-created, gitignored)

`designs/`, `output/`, `mockups/`, `uploads/` (multer scratch), `templates/` (copy-source listing template dir used by `upload-etsy.js`), `data/`, `logs/`.

## UI

`public/index.html` is a single ~188 KB standalone HTML app (no build step). `public/login.html` is unused (see above). Edits to UI go directly into these files.
