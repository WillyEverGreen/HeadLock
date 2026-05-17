# HeadLock 🔒
Private self-hosted headless browser API. Playwright + Express on Hugging Face Spaces.
Free alternative to Browserless.io for personal use.

## Deploy to HF Spaces
1. Create a Docker Space on [huggingface.co](https://huggingface.co/)
2. Add secrets: `SECRET_TOKEN`, `MAX_CONCURRENT=3`, `PAGE_TIMEOUT=30000`
3. Push this repo to the Space
4. Set up UptimeRobot on `/health` to prevent sleep

## Endpoints
| Method | Route | Returns |
|---|---|---|
| POST | `/scrape/html` | Rendered HTML |
| POST | `/scrape/text` | Inner text |
| POST | `/scrape/screenshot` | Base64 PNG |
| POST | `/scrape/pdf` | Base64 PDF |
| POST | `/scrape/json` | JS evaluation result |
| GET | `/health` | Pool stats (public) |

All routes require `Authorization: Bearer <SECRET_TOKEN>` except `/health`.

## Vercel Integration
Set `SCRAPER_URL` and `SCRAPER_TOKEN` env vars, then use `lib/scraper.js`.

→ Full docs: [DOCS.md](./DOCS.md)
