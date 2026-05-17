/**
 * HeadLock Test Suite
 * 
 * Tests auth middleware, all scrape endpoints, health check,
 * error handling, and edge cases.
 * 
 * Setup:
 *   npm install --save-dev jest supertest
 * 
 * Run:
 *   SECRET_TOKEN=test-secret npx jest headlock.test.js
 * 
 * Note: Tests marked [UNIT] mock the browser — no Chromium needed.
 *       Tests marked [INTEGRATION] require a running server with Chromium.
 */

const request = require('supertest');

// ─── Mock browser manager so unit tests don't need Chromium ──────────────────

const mockPage = {
  setDefaultTimeout: jest.fn(),
  setExtraHTTPHeaders: jest.fn(),
  context: jest.fn(() => ({ addCookies: jest.fn() })),
  goto: jest.fn(() => ({ status: () => 200 })),
  content: jest.fn(() => '<html><body>Hello</body></html>'),
  waitForSelector: jest.fn(),
  $eval: jest.fn(() => 'Hello'),
  screenshot: jest.fn(() => Buffer.from('fakepng')),
  pdf: jest.fn(() => Buffer.from('fakepdf')),
  evaluate: jest.fn(() => ({ title: 'Test Page' })),
  close: jest.fn(),
};

jest.mock('./utils/browser', () => ({
  init: jest.fn().mockResolvedValue(undefined),
  acquirePage: jest.fn().mockResolvedValue(mockPage),
  releasePage: jest.fn().mockResolvedValue(undefined),
  getStats: jest.fn(() => ({ queueLength: 0, activeSessions: 1 })),
  close: jest.fn().mockResolvedValue(undefined),
  maxConcurrent: 3,
  maxQueue: 10,
}));

// ─── Load app after mocking ───────────────────────────────────────────────────

process.env.SECRET_TOKEN = 'test-secret-token';
process.env.PORT = '7861';
process.env.PAGE_TIMEOUT = '30000';

// We need to load server without it actually listening
// So we extract the express app from server.js
// If your server.js exports `app`, use that. Otherwise use supertest with the port.
// For this test we rebuild a minimal app matching your server.js structure:

const express = require('express');
const authMiddleware = require('./middleware/auth');
const scrapeRouter = require('./routes/scrape');
const browserManager = require('./utils/browser');

function buildApp() {
  const app = express();
  const startTime = Date.now();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const stats = browserManager.getStats();
    res.status(200).json({ status: 'ok', uptime, ...stats });
  });

  app.use('/scrape', authMiddleware, scrapeRouter);

  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND', timeTaken: 0 });
  });

  return app;
}

const TOKEN = 'test-secret-token';
const WRONG_TOKEN = 'wrong-token';
const AUTH = { Authorization: `Bearer ${TOKEN}` };

// ─────────────────────────────────────────────────────────────────────────────
// 1. HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────

describe('[UNIT] GET /health', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('returns uptime as a number', async () => {
    const res = await request(app).get('/health');
    expect(typeof res.body.uptime).toBe('number');
  });

  test('returns queueLength and activeSessions', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toHaveProperty('queueLength');
    expect(res.body).toHaveProperty('activeSessions');
  });

  test('does NOT require auth header', async () => {
    const res = await request(app).get('/health');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. AUTH MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

describe('[UNIT] Auth Middleware', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
  });

  test('returns 403 when format is not Bearer <token>', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set('Authorization', TOKEN) // missing "Bearer " prefix
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVALID_TOKEN_FORMAT');
  });

  test('returns 403 for Basic auth format', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set('Authorization', `Basic ${TOKEN}`)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVALID_TOKEN_FORMAT');
  });

  test('returns 401 when token is wrong', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set('Authorization', `Bearer ${WRONG_TOKEN}`)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  test('passes through with correct token', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test('error shape always includes error, code, timeTaken', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .send({ url: 'https://example.com' });
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('code');
    expect(res.body).toHaveProperty('timeTaken');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. URL VALIDATION (common to all routes)
// ─────────────────────────────────────────────────────────────────────────────

describe('[UNIT] URL Validation', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('returns 400 MISSING_URL when url is omitted', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_URL');
  });

  test('returns 400 INVALID_URL for a non-URL string', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({ url: 'not-a-url' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_URL');
  });

  test('returns 400 INVALID_URL for relative path', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({ url: '/relative/path' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_URL');
  });

  test('accepts valid http URL', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({ url: 'http://example.com' });
    expect(res.status).toBe(200);
  });

  test('accepts valid https URL', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /scrape/html
// ─────────────────────────────────────────────────────────────────────────────

describe('[UNIT] POST /scrape/html', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('returns 200 with html, status, timeTaken', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('html');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timeTaken');
  });

  test('html field is a string', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(typeof res.body.html).toBe('string');
  });

  test('accepts optional waitFor selector without error', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({ url: 'https://example.com', waitFor: '.content' });
    expect(res.status).toBe(200);
  });

  test('timeTaken is a non-negative number', async () => {
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(typeof res.body.timeTaken).toBe('number');
    expect(res.body.timeTaken).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. POST /scrape/text
// ─────────────────────────────────────────────────────────────────────────────

describe('[UNIT] POST /scrape/text', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('returns 200 with text, status, timeTaken', async () => {
    const res = await request(app)
      .post('/scrape/text')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('text');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timeTaken');
  });

  test('text field is a string', async () => {
    const res = await request(app)
      .post('/scrape/text')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(typeof res.body.text).toBe('string');
  });

  test('accepts optional CSS selector', async () => {
    const res = await request(app)
      .post('/scrape/text')
      .set(AUTH)
      .send({ url: 'https://example.com', selector: 'h1' });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. POST /scrape/screenshot
// ─────────────────────────────────────────────────────────────────────────────

describe('[UNIT] POST /scrape/screenshot', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('returns 200 with screenshot, status, timeTaken', async () => {
    const res = await request(app)
      .post('/scrape/screenshot')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('screenshot');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timeTaken');
  });

  test('screenshot is a base64 string', async () => {
    const res = await request(app)
      .post('/scrape/screenshot')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(typeof res.body.screenshot).toBe('string');
    // Valid base64 only has these characters
    expect(res.body.screenshot).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  test('accepts fullPage boolean', async () => {
    const res = await request(app)
      .post('/scrape/screenshot')
      .set(AUTH)
      .send({ url: 'https://example.com', fullPage: true });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. POST /scrape/pdf
// ─────────────────────────────────────────────────────────────────────────────

describe('[UNIT] POST /scrape/pdf', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('returns 200 with pdf, status, timeTaken', async () => {
    const res = await request(app)
      .post('/scrape/pdf')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pdf');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timeTaken');
  });

  test('pdf is a base64 string', async () => {
    const res = await request(app)
      .post('/scrape/pdf')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(typeof res.body.pdf).toBe('string');
    expect(res.body.pdf).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. POST /scrape/json
// ─────────────────────────────────────────────────────────────────────────────

describe('[UNIT] POST /scrape/json', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('returns 400 MISSING_EVALUATE when evaluate is omitted', async () => {
    const res = await request(app)
      .post('/scrape/json')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_EVALUATE');
  });

  test('returns 200 with result, status, timeTaken for arrow function', async () => {
    const res = await request(app)
      .post('/scrape/json')
      .set(AUTH)
      .send({
        url: 'https://example.com',
        evaluate: '() => document.title'
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('result');
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('timeTaken');
  });

  test('accepts function keyword expression', async () => {
    const res = await request(app)
      .post('/scrape/json')
      .set(AUTH)
      .send({
        url: 'https://example.com',
        evaluate: 'function() { return document.title; }'
      });
    expect(res.status).toBe(200);
  });

  test('accepts plain expression string', async () => {
    const res = await request(app)
      .post('/scrape/json')
      .set(AUTH)
      .send({
        url: 'https://example.com',
        evaluate: 'document.title'
      });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. CORS HEADERS
// ─────────────────────────────────────────────────────────────────────────────

describe('[UNIT] CORS Headers', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('GET /health returns Access-Control-Allow-Origin: *', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  test('OPTIONS preflight returns 200', async () => {
    const res = await request(app)
      .options('/scrape/html')
      .set('Origin', 'https://my-app.vercel.app')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. 404 HANDLER
// ─────────────────────────────────────────────────────────────────────────────

describe('[UNIT] 404 Handler', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  test('unknown route returns 404 NOT_FOUND', async () => {
    const res = await request(app).get('/unknown-route');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  test('unknown scrape type returns 404', async () => {
    const res = await request(app)
      .post('/scrape/video')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. ERROR SHAPE CONSISTENCY
// ─────────────────────────────────────────────────────────────────────────────

describe('[UNIT] Error Shape Consistency', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  const errorCases = [
    { desc: '401 missing token', fn: () => request(app).post('/scrape/html').send({ url: 'https://example.com' }) },
    { desc: '400 missing url',   fn: () => request(app).post('/scrape/html').set(AUTH).send({}) },
    { desc: '400 invalid url',   fn: () => request(app).post('/scrape/html').set(AUTH).send({ url: 'bad' }) },
    { desc: '400 missing eval',  fn: () => request(app).post('/scrape/json').set(AUTH).send({ url: 'https://example.com' }) },
  ];

  test.each(errorCases)('$desc always has error + code + timeTaken', async ({ fn }) => {
    const res = await fn();
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('code');
    expect(res.body).toHaveProperty('timeTaken');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. BROWSER ERROR HANDLING
// ─────────────────────────────────────────────────────────────────────────────

describe('[UNIT] Browser Error Handling', () => {
  let app;

  test('returns 408 TIMEOUT when page.goto times out', async () => {
    const browserManager = require('./utils/browser');
    const timeoutPage = {
      ...mockPage,
      goto: jest.fn(() => { throw Object.assign(new Error('page.goto: Timeout 30000ms exceeded'), { name: 'TimeoutError' }); }),
    };
    browserManager.acquirePage.mockResolvedValueOnce(timeoutPage);

    app = buildApp();
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(408);
    expect(res.body.code).toBe('TIMEOUT');
  });

  test('returns 429 QUEUE_LIMIT_EXCEEDED when queue is full', async () => {
    const browserManager = require('./utils/browser');
    const queueErr = Object.assign(new Error('Queue limit exceeded'), { code: 'QUEUE_LIMIT_EXCEEDED' });
    browserManager.acquirePage.mockRejectedValueOnce(queueErr);

    app = buildApp();
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('QUEUE_LIMIT_EXCEEDED');
  });

  test('returns 500 SCRAPE_ERROR on generic browser crash', async () => {
    const browserManager = require('./utils/browser');
    browserManager.acquirePage.mockRejectedValueOnce(new Error('Browser crashed unexpectedly'));

    app = buildApp();
    const res = await request(app)
      .post('/scrape/html')
      .set(AUTH)
      .send({ url: 'https://example.com' });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('SCRAPE_ERROR');
  });
});
