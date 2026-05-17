require('dotenv').config();
const express = require('express');
const authMiddleware = require('./middleware/auth');
const scrapeRouter = require('./routes/scrape');
const browserManager = require('./utils/browser');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 7860;
const startTime = Date.now();

// 1. Parse JSON payloads (limit to 5mb in case custom options/cookies are large)
app.use(express.json({ limit: '5mb' }));

// 2. Health Endpoint (Public - required by HF Spaces container check)
app.get('/health', (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const stats = browserManager.getStats();

  res.status(200).json({
    status: "ok",
    uptime,
    queueLength: stats.queueLength,
    activeSessions: stats.activeSessions
  });
});

// 3. Register the authenticated scrape routes
app.use('/scrape', authMiddleware, scrapeRouter);

// 4. Global 404 Route
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    code: "NOT_FOUND",
    timeTaken: 0
  });
});

// 5. Global Error Handler
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Unhandled Server Error:`, err);
  res.status(500).json({
    error: "Internal Server Error",
    code: "INTERNAL_SERVER_ERROR",
    timeTaken: 0
  });
});

// 6. Start the server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] Headlock Scraper Server running on http://0.0.0.0:${PORT}`);
  console.log(`[${new Date().toISOString()}] Concurrency limit: ${browserManager.maxConcurrent}`);
  console.log(`[${new Date().toISOString()}] Scraper operations timeout: ${process.env.PAGE_TIMEOUT || 30000}ms`);
});

// 7. Graceful Shutdown Handlers
async function handleShutdown(signal) {
  console.log(`\n[${new Date().toISOString()}] ${signal} received. Starting graceful shutdown...`);
  
  // Close HTTP server first to refuse new requests
  server.close(() => {
    console.log(`[${new Date().toISOString()}] HTTP server stopped.`);
  });

  // Release browser pool resources
  try {
    await browserManager.close();
    console.log(`[${new Date().toISOString()}] Browser manager closed successfully.`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error closing browser manager:`, err);
  }

  console.log(`[${new Date().toISOString()}] Graceful shutdown completed. Exiting.`);
  process.exit(0);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
