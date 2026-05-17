require('dotenv').config();
const express = require('express');
const authMiddleware = require('./middleware/auth');
const scrapeRouter = require('./routes/scrape');
const browserManager = require('./utils/browser');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 7860;
const startTime = Date.now();

// CORS Middleware to support dynamic origins (e.g. Hugging Face Space URL renames)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

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

// 2.5. Root Landing Page (Public - serves a gorgeous, portfolio-ready HTML dashboard)
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HeadLock | Headless Browser API</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0A0E1A;
      --card-bg: rgba(16, 22, 42, 0.6);
      --border: rgba(255, 255, 255, 0.08);
      --text: #F3F4F6;
      --text-muted: #9CA3AF;
      --accent: #3B82F6;
      --accent-glow: rgba(59, 130, 246, 0.15);
      --success: #10B981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
      overflow-x: hidden;
    }
    .grid-bg {
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      background-image: linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
      background-size: 40px 40px;
      z-index: -1;
      opacity: 0.8;
    }
    .glow {
      position: absolute;
      width: 400px; height: 400px;
      background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
      top: 10%; left: 50%;
      transform: translate(-50%, -50%);
      z-index: -1;
      filter: blur(50px);
      pointer-events: none;
    }
    .container {
      width: 100%;
      max-width: 680px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      backdrop-filter: blur(16px);
      border-radius: 24px;
      padding: 2.5rem;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
    }
    .logo-section h1 {
      font-size: 2.2rem;
      font-weight: 800;
      letter-spacing: -1px;
      background: linear-gradient(135deg, #FFF 40%, var(--accent) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .logo-section p {
      font-size: 0.95rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
    .badge {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.2);
      color: var(--success);
      padding: 0.5rem 1rem;
      border-radius: 99px;
      font-weight: 600;
      font-size: 0.85rem;
    }
    .pulse {
      width: 8px; height: 8px;
      background-color: var(--success);
      border-radius: 50%;
      animation: pulse-animation 2s infinite;
    }
    @keyframes pulse-animation {
      0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
      100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.2rem;
      text-align: center;
      transition: border-color 0.3s;
    }
    .stat-card:hover {
      border-color: var(--accent);
    }
    .stat-val {
      font-size: 1.8rem;
      font-weight: 800;
      color: #FFF;
      margin-bottom: 0.25rem;
    }
    .stat-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
      font-weight: 600;
    }
    .endpoints-section h2 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: #FFF;
    }
    .endpoint-card {
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 0.75rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .endpoint-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .method {
      font-size: 0.75rem;
      font-weight: 800;
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      text-transform: uppercase;
    }
    .method.post { background: rgba(59, 130, 246, 0.15); color: var(--accent); border: 1px solid rgba(59, 130, 246, 0.3); }
    .method.get { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
    .path { font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; color: #FFF; }
    .desc { font-size: 0.85rem; color: var(--text-muted); }
    .footer {
      text-align: center;
      margin-top: 2rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .footer a { color: var(--accent); text-decoration: none; font-weight: 600; }
    .footer a:hover { text-decoration: underline; }
    @media (max-width: 600px) {
      .stats-grid { grid-template-columns: 1fr; }
      .header { flex-direction: column; align-items: flex-start; gap: 1rem; }
    }
  </style>
</head>
<body>
  <div class="grid-bg"></div>
  <div class="glow"></div>
  <div class="container">
    <div class="header">
      <div class="logo-section">
        <h1>HeadLock 🔒</h1>
        <p>Private Hosted Headless Browser API</p>
      </div>
      <div class="badge">
        <div class="pulse"></div>
        <span>ACTIVE</span>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-val" id="uptime">0s</div>
        <div class="stat-label">System Uptime</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" id="sessions">0</div>
        <div class="stat-label">Active Slots</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" id="queue">0</div>
        <div class="stat-label">Queue Length</div>
      </div>
    </div>

    <div class="endpoints-section">
      <h2>📡 Available Endpoints</h2>
      
      <div class="endpoint-card">
        <div class="endpoint-info">
          <span class="method post">POST</span>
          <span class="path">/scrape/html</span>
        </div>
        <span class="desc">Rendered HTML Scraper</span>
      </div>

      <div class="endpoint-card">
        <div class="endpoint-info">
          <span class="method post">POST</span>
          <span class="path">/scrape/text</span>
        </div>
        <span class="desc">Element Inner Text Scraper</span>
      </div>

      <div class="endpoint-card">
        <div class="endpoint-info">
          <span class="method post">POST</span>
          <span class="path">/scrape/screenshot</span>
        </div>
        <span class="desc">Base64 PNG Screenshot</span>
      </div>

      <div class="endpoint-card">
        <div class="endpoint-info">
          <span class="method post">POST</span>
          <span class="path">/scrape/pdf</span>
        </div>
        <span class="desc">Print-Ready Base64 PDF</span>
      </div>

      <div class="endpoint-card">
        <div class="endpoint-info">
          <span class="method post">POST</span>
          <span class="path">/scrape/json</span>
        </div>
        <span class="desc">Custom JS Evaluation</span>
      </div>

      <div class="endpoint-card">
        <div class="endpoint-info">
          <span class="method get">GET</span>
          <span class="path">/health</span>
        </div>
        <span class="desc">Public Pool Statistics</span>
      </div>
    </div>

    <div class="footer">
      Powered by Express, Playwright & Docker. View <a href="https://github.com/WillyEverGreen/HeadLock" target="_blank">Documentation on GitHub</a>
    </div>
  </div>

  <script>
    function formatUptime(seconds) {
      if (seconds < 60) return seconds + 's';
      const mins = Math.floor(seconds / 60);
      if (mins < 60) return mins + 'm ' + (seconds % 60) + 's';
      const hours = Math.floor(mins / 60);
      return hours + 'h ' + (mins % 60) + 'm';
    }

    async function updateStats() {
      try {
        const response = await fetch('/health');
        if (response.ok) {
          const data = await response.json();
          document.getElementById('uptime').innerText = formatUptime(data.uptime);
          document.getElementById('sessions').innerText = data.activeSessions;
          document.getElementById('queue').innerText = data.queueLength;
        }
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      }
    }

    updateStats();
    setInterval(updateStats, 5000);
  </script>
</body>
</html>`);
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
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[${new Date().toISOString()}] Headlock Scraper Server running on http://0.0.0.0:${PORT}`);
  console.log(`[${new Date().toISOString()}] Concurrency limit: ${browserManager.maxConcurrent}`);
  console.log(`[${new Date().toISOString()}] Max queue size: ${browserManager.maxQueue}`);
  console.log(`[${new Date().toISOString()}] Scraper operations timeout: ${process.env.PAGE_TIMEOUT || 30000}ms`);
  
  // Eager browser initialization (warm up Chromium to eliminate cold start launch penalty)
  try {
    await browserManager.init();
    console.log(`[${new Date().toISOString()}] Browser pool warmed up eagerly. Chromium is ready.`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Failed to warm up Chromium eagerly during startup:`, err.message);
  }
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
