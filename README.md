# Interview Navigator v4

This repo now behaves more like a real interview-prep product instead of a demo.

## What changed

- Chinese-source search is rewritten automatically for Nowcoder and Xiaohongshu.
- Live scrape results are filtered and ranked toward real post/detail pages.
- Direct source links and search fallbacks are clearly separated in the UI.
- Resume parsing is more conservative and now separates priority rewrites, optional polish, and keep-as-is lines.
- Workspace bootstrap and health checks expose crawler + cookie status.

## Key backend endpoints

- `GET /api/health`
  Returns storage mode and crawler status.
- `GET /api/interview/crawler/status`
  Returns per-source crawler state:
  - `crawlerEnabled`
  - `cookieConfigured`
  - `cookieValid`
  - `cookieInjectedLastRun`
  - `authenticatedLikely`
  - `lastError`
- `GET /api/interview/scrape/debug?company=...&role=...&interviewType=...`
  Returns:
  - rewritten Chinese queries by source
  - raw candidate count
  - filtered result count
  - excluded candidates and reasons
  - per-source diagnostics

## Chinese query rewriting

When the target source is a Chinese site, the backend rewrites search input into Chinese internet-style keyword combinations before crawling.

Example:

- raw input: `Tencent Business Development Intern interview experience`
- rewritten queries:
  - `腾讯 商务拓展实习 面经`
  - `腾讯 BD 实习 面试`
  - `腾讯 商务拓展 一面 二面`

The original user input is still preserved in debug output and the frontend evidence page.

## Live crawling and cookies

These sources depend on authenticated browser sessions for better results:

- Nowcoder
- Xiaohongshu

You must configure the following backend environment variables:

- `ALLOW_LIVE_SCRAPE=true`
- `NOWCODER_COOKIE=<full browser cookie header>`
- `XIAOHONGSHU_COOKIE=<full browser cookie header>`

Notes:

- Do not paste partial cookie fragments.
- Copy the full `Cookie` request header from a logged-in browser session.
- The UI never exposes cookie values.
- If cookies are missing or likely invalid, the evidence page falls back honestly to search results.

## Deployment

Current deployment shape stays the same:

- Frontend: Vercel
- Backend: Render
- LLM: OpenAI API

Important environment variables on Render:

- `OPENAI_API_KEY`
- `DATABASE_URL` when database mode is enabled
- `DATABASE_SSL`
- `ALLOW_LIVE_SCRAPE`
- `PLAYWRIGHT_HEADLESS`
- `SCRAPE_TIMEOUT_MS`
- `NOWCODER_COOKIE`
- `XIAOHONGSHU_COOKIE`
- `ALLOWED_ORIGIN`

Important environment variables on Vercel:

- `VITE_API_BASE_URL`

## Validation checklist

1. Open `GET /api/health` and confirm crawler status is returned.
2. Open `GET /api/interview/crawler/status` and confirm each source reports real cookie state.
3. Open `GET /api/interview/scrape/debug?company=Tencent&role=Business%20Development%20Intern&interviewType=professional`.
4. Confirm debug output shows rewritten Chinese queries instead of raw English-only search.
5. Confirm returned results are mostly post/detail URLs instead of landing pages.
6. Generate a prep pack and verify the evidence page shows:
   - source status cards
   - query rewrite notes
   - direct vs fallback labels
7. Upload a resume and verify the resume page shows:
   - structured preview
   - top 3-5 rewrite priorities
   - optional polish
   - keep-as-is lines
   - compact story bank

## Known limits

- Xiaohongshu and Nowcoder may still change DOM structure, add stronger anti-bot checks, or block headless sessions.
- Snippets are extracted from search/list pages, not full article bodies.
- If a site shows login walls or captcha, cookie status may remain `unknown` until a successful authenticated run.
