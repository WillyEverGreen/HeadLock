/**
 * HeadLock Scraper client wrapper for Next.js / Vercel projects.
 * 
 * Ready-to-use fetch wrapper for calling your private Hugging Face Space.
 * Make sure to define SCRAPER_URL and SCRAPER_TOKEN in your Vercel environment.
 * 
 * @param {('html'|'text'|'screenshot'|'pdf'|'json')} type - Scrape action type.
 * @param {Object} payload - Scrape configurations.
 * @param {string} payload.url - Webpage URL to scrape.
 * @param {string} [payload.waitFor] - For 'html': Wait for CSS selector to load.
 * @param {string} [payload.selector] - For 'text': Extract text inside CSS selector (defaults to 'body').
 * @param {boolean} [payload.fullPage] - For 'screenshot': Take a full page screenshot.
 * @param {string} [payload.evaluate] - For 'json': Evaluate custom JS function string in page.
 * @param {Object} [payload.headers] - Inject custom HTTP headers.
 * @param {Array<Object>} [payload.cookies] - Inject session/auth cookies.
 * 
 * @returns {Promise<Object>} Response object containing output data and execution stats.
 */
export async function scrape(type, payload) {
  const scraperUrl = process.env.SCRAPER_URL;
  const scraperToken = process.env.SCRAPER_TOKEN;

  if (!scraperUrl) {
    throw new Error("SCRAPER_URL environment variable is missing on Vercel.");
  }
  if (!scraperToken) {
    throw new Error("SCRAPER_TOKEN environment variable is missing on Vercel.");
  }

  // Ensure trailing slash is cleaned
  const sanitizedUrl = scraperUrl.replace(/\/$/, "");

  const res = await fetch(`${sanitizedUrl}/scrape/${type}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${scraperToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    let errMsg = `Server responded with ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson.error) {
        errMsg = errJson.error;
      }
    } catch (_) {}
    throw new Error(`Scraper error: ${errMsg}`);
  }

  return res.json();
}
