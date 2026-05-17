const { chromium } = require('playwright');

/**
 * BrowserManager
 * 
 * Manages a single shared Chromium instance with a concurrent page pool.
 * If all page slots are occupied, incoming requests are queued and processed
 * once a slot becomes available. Automatically restarts the browser on crash.
 */
class BrowserManager {
  constructor() {
    this.browser = null;
    this.activeSessions = 0;
    this.queue = [];
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT, 10) || 3;
  }

  /**
   * Initializes the shared Chromium instance if not already running.
   */
  async init() {
    if (this.browser) return this.browser;

    console.log(`[${new Date().toISOString()}] Launching Playwright Chromium instance...`);
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    // Handle unexpected browser crashes or exits
    this.browser.on('disconnected', () => {
      console.error(`[${new Date().toISOString()}] Chromium browser disconnected or crashed! Resetting pool...`);
      this.browser = null;
      
      // Terminate any pending queued items with a browser crash error
      const activeQueue = this.queue;
      this.queue = [];
      this.activeSessions = 0;
      for (const item of activeQueue) {
        item.reject(new Error("Browser crashed or disconnected during request queueing"));
      }
    });

    return this.browser;
  }

  /**
   * Acquires a browser page. If the concurrency limit is reached,
   * it queues the request and waits for an available slot.
   * 
   * @param {number} timeoutMs Maximum time to wait in queue.
   * @returns {Promise<Page>} Playwright Page instance.
   */
  async acquirePage(timeoutMs) {
    await this.init();

    // If we have an available slot, spin up a new page immediately
    if (this.activeSessions < this.maxConcurrent) {
      this.activeSessions++;
      try {
        console.log(`[${new Date().toISOString()}] Page slot acquired immediately. (Active: ${this.activeSessions}/${this.maxConcurrent})`);
        const page = await this.browser.newPage();
        return page;
      } catch (err) {
        this.activeSessions--;
        throw err;
      }
    }

    console.log(`[${new Date().toISOString()}] Concurrency limit reached (${this.maxConcurrent}). Queueing request (Queue size: ${this.queue.length + 1})...`);

    // Queue request and wait for a release
    return new Promise((resolve, reject) => {
      let isTimedOut = false;
      const timer = setTimeout(() => {
        isTimedOut = true;
        // Remove from queue
        this.queue = this.queue.filter(item => item.resolve !== resolve);
        console.warn(`[${new Date().toISOString()}] Request timed out waiting for an available browser slot in queue.`);
        const timeoutErr = new Error("Timeout waiting for a free browser slot");
        timeoutErr.code = 'TIMEOUT';
        reject(timeoutErr);
      }, timeoutMs);

      this.queue.push({
        resolve: (page) => {
          clearTimeout(timer);
          if (isTimedOut) {
            console.log(`[${new Date().toISOString()}] Page acquired but request already timed out. Closing page immediately.`);
            this.releasePage(page).catch(() => {});
          } else {
            resolve(page);
          }
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  /**
   * Releases a page back to the pool, closing it, and resolves
   * the next queued request if one is waiting.
   * 
   * @param {Page} page Playwright Page instance to close.
   */
  async releasePage(page) {
    if (page) {
      try {
        await page.close();
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Error closing page:`, err.message);
      }
    }

    if (this.queue.length > 0) {
      const nextRequest = this.queue.shift();
      console.log(`[${new Date().toISOString()}] Releasing page slot. Dequeueing next request. (Remaining queue: ${this.queue.length})`);
      try {
        if (!this.browser) {
          throw new Error("Browser is not active or has crashed.");
        }
        const newPage = await this.browser.newPage();
        nextRequest.resolve(newPage);
      } catch (err) {
        nextRequest.reject(err);
        this.activeSessions = Math.max(0, this.activeSessions - 1);
        this.triggerNextQueue();
      }
    } else {
      this.activeSessions = Math.max(0, this.activeSessions - 1);
      console.log(`[${new Date().toISOString()}] Releasing page slot. (Active: ${this.activeSessions}/${this.maxConcurrent})`);
    }
  }

  /**
   * Helper to trigger next queue item if a failure occurred.
   */
  triggerNextQueue() {
    if (this.queue.length > 0 && this.activeSessions < this.maxConcurrent) {
      this.activeSessions++;
      const nextRequest = this.queue.shift();
      console.log(`[${new Date().toISOString()}] Queue trigger: Dequeueing next request. (Remaining queue: ${this.queue.length})`);
      this.browser.newPage()
        .then(page => nextRequest.resolve(page))
        .catch(err => {
          nextRequest.reject(err);
          this.activeSessions = Math.max(0, this.activeSessions - 1);
          this.triggerNextQueue();
        });
    }
  }

  /**
   * Returns current queue and session statistics.
   */
  getStats() {
    return {
      activeSessions: this.activeSessions,
      queueLength: this.queue.length
    };
  }

  /**
   * Closes the shared browser instance.
   */
  async close() {
    if (this.browser) {
      console.log(`[${new Date().toISOString()}] Closing browser instance...`);
      await this.browser.close();
      this.browser = null;
      this.activeSessions = 0;
      this.queue = [];
    }
  }
}

// Export singleton instance
module.exports = new BrowserManager();
