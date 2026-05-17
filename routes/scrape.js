const express = require('express');
const router = express.Router();
const browserManager = require('../utils/browser');

const PAGE_TIMEOUT = parseInt(process.env.PAGE_TIMEOUT, 10) || 30000;

/**
 * Common Scraping Execution Wrapper
 * 
 * Enforces URL validation, a global request timeout, extra headers and cookie
 * injection, page-level operation limits, structured JSON outputs, clean
 * error mapping, and page pool resource de-allocation under all circumstances.
 */
async function runScrapeJob(req, res, handler) {
  const startTime = Date.now();
  const { url, headers, cookies } = req.body;

  // 1. Validate URL presence
  if (!url) {
    return res.status(400).json({
      error: "Bad Request: 'url' parameter is required.",
      code: "MISSING_URL",
      timeTaken: Date.now() - startTime
    });
  }

  // 2. Validate URL structure
  try {
    new URL(url);
  } catch (_) {
    return res.status(400).json({
      error: "Bad Request: 'url' must be a valid absolute URL.",
      code: "INVALID_URL",
      timeTaken: Date.now() - startTime
    });
  }

  let page = null;
  try {
    const elapsed = Date.now() - startTime;
    const remaining = PAGE_TIMEOUT - elapsed;

    if (remaining <= 0) {
      const err = new Error("Request timed out before acquiring a browser slot");
      err.code = 'TIMEOUT';
      throw err;
    }

    // 3. Acquire page from pool (waits up to remaining time)
    page = await browserManager.acquirePage(remaining);

    // Recalculate remaining timeout for actual page operations
    const afterAcquireElapsed = Date.now() - startTime;
    const scrapeRemaining = PAGE_TIMEOUT - afterAcquireElapsed;

    if (scrapeRemaining <= 0) {
      const err = new Error("Request timed out after acquiring a browser slot");
      err.code = 'TIMEOUT';
      throw err;
    }

    // Set timeout limit for Playwright page navigation and action methods
    page.setDefaultTimeout(scrapeRemaining);

    // 4. Inject Custom Headers
    if (headers && typeof headers === 'object') {
      await page.setExtraHTTPHeaders(headers);
    }

    // 5. Inject Cookies
    if (cookies && Array.isArray(cookies)) {
      await page.context().addCookies(cookies.map(cookie => ({
        ...cookie,
        url: cookie.url || url // Fallback to destination URL if none specified on the cookie
      })));
    }

    // 6. Navigate to target URL
    console.log(`[${new Date().toISOString()}] Navigating to: ${url}`);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    const status = response ? response.status() : 200;

    // 7. Execute route-specific action
    const result = await handler(page);

    const timeTaken = Date.now() - startTime;
    return res.json({
      ...result,
      status,
      timeTaken
    });

  } catch (err) {
    const timeTaken = Date.now() - startTime;
    const isTimeout = err.name === 'TimeoutError' || err.message.includes('timeout') || err.code === 'TIMEOUT';
    const isQueueLimit = err.code === 'QUEUE_LIMIT_EXCEEDED';
    
    let statusCode = 500;
    let code = 'SCRAPE_ERROR';
    let errorMsg = err.message;

    if (isTimeout) {
      statusCode = 408;
      code = 'TIMEOUT';
      errorMsg = "Request timed out during scraping operation";
    } else if (isQueueLimit) {
      statusCode = 429;
      code = 'QUEUE_LIMIT_EXCEEDED';
    }

    // Log the error to stdout with timestamp as requested
    console.error(`[${new Date().toISOString()}] Error scraping "${url}":`, err.stack || err.message);

    return res.status(statusCode).json({
      error: errorMsg,
      code,
      timeTaken
    });
  } finally {
    // 8. Always release page back to pool
    if (page) {
      await browserManager.releasePage(page);
    }
  }
}

/**
 * POST /scrape/html
 * Inputs: { url, waitFor?, headers?, cookies? }
 * Returns: { html, status, timeTaken }
 */
router.post('/html', async (req, res) => {
  const { waitFor } = req.body;
  await runScrapeJob(req, res, async (page) => {
    if (waitFor) {
      console.log(`[${new Date().toISOString()}] Waiting for CSS selector: ${waitFor}`);
      await page.waitForSelector(waitFor);
    }
    const html = await page.content();
    return { html };
  });
});

/**
 * POST /scrape/text
 * Inputs: { url, selector?, headers?, cookies? }
 * Returns: { text, status, timeTaken }
 */
router.post('/text', async (req, res) => {
  const { selector } = req.body;
  await runScrapeJob(req, res, async (page) => {
    const targetSelector = selector || 'body';
    console.log(`[${new Date().toISOString()}] Extracting text from: ${targetSelector}`);
    await page.waitForSelector(targetSelector);
    const text = await page.$eval(targetSelector, el => el.innerText || el.textContent || '');
    return { text };
  });
});

/**
 * POST /scrape/screenshot
 * Inputs: { url, fullPage?, headers?, cookies? }
 * Returns: { screenshot: "base64String", status, timeTaken }
 */
router.post('/screenshot', async (req, res) => {
  const { fullPage } = req.body;
  await runScrapeJob(req, res, async (page) => {
    console.log(`[${new Date().toISOString()}] Capturing screenshot (fullPage: ${!!fullPage})`);
    const buffer = await page.screenshot({ fullPage: !!fullPage, type: 'png' });
    const screenshot = buffer.toString('base64');
    return { screenshot };
  });
});

/**
 * POST /scrape/pdf
 * Inputs: { url, headers?, cookies? }
 * Returns: { pdf: "base64String", status, timeTaken }
 */
router.post('/pdf', async (req, res) => {
  await runScrapeJob(req, res, async (page) => {
    console.log(`[${new Date().toISOString()}] Rendering PDF`);
    const buffer = await page.pdf({ format: 'A4', printBackground: true });
    const pdf = buffer.toString('base64');
    return { pdf };
  });
});

/**
 * POST /scrape/json
 * Inputs: { url, evaluate, headers?, cookies? }
 * Returns: { result, status, timeTaken }
 */
router.post('/json', async (req, res) => {
  const { evaluate } = req.body;

  if (!evaluate) {
    return res.status(400).json({
      error: "Bad Request: 'evaluate' JS function string is required.",
      code: "MISSING_EVALUATE",
      timeTaken: 0
    });
  }

  await runScrapeJob(req, res, async (page) => {
    console.log(`[${new Date().toISOString()}] Evaluating JS in browser context`);
    
    let result;
    const evalStr = evaluate.trim();

    // Check if the script looks like a function expression or arrow function and parse/call appropriately
    if (evalStr.startsWith('(') || evalStr.startsWith('function') || evalStr.includes('=>')) {
      result = await page.evaluate(`(${evalStr})()`);
    } else {
      result = await page.evaluate(evalStr);
    }

    return { result };
  });
});

module.exports = router;
