const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class ExtensionScraper {
  async initialize() {
    this.browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--js-flags=--max-old-space-size=4096'
      ]
    });
  }

  async optimizePage(page) {
    // Set timeouts
    await page.setDefaultNavigationTimeout(60000);
    await page.setDefaultTimeout(30000);
    
    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Optimize memory usage
    await page.evaluate(() => {
      window.addEventListener('beforeunload', () => {
        const highestId = window.setTimeout(() => {}, 0);
        for (let i = 0; i < highestId; i++) {
          window.clearTimeout(i);
          window.clearInterval(i);
        }
      });
    });
  }

  async waitForNavigation(page, url, attempt = 1) {
    const maxAttempts = 3;
    const baseDelay = 2000; // 2 seconds

    try {
      // Try domcontentloaded first as it's faster
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 + (attempt * 10000) // Increase timeout with each attempt
      });

      // Wait for key content to be available
      await page.waitForSelector('.ux-item-name, h1[itemprop="name"]', { 
        timeout: 20000 + (attempt * 5000)
      });

      return true;
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }

      // Calculate exponential backoff delay
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`⏳ Kutish vaqti ${delay}ms, urinish ${attempt}/${maxAttempts}`);
      await new Promise(resolve => setTimeout(resolve, delay));

      // Retry with networkidle0 on subsequent attempts
      return this.waitForNavigation(page, url, attempt + 1);
    }
  }

  async saveExtensionContent(url, savePath, page = null) {
    let ownPage = false;
    try {
      if (!page) {
        ownPage = true;
        page = await this.browser.newPage();
        await this.optimizePage(page);
      }
      
      const urlMatch = url.match(/itemName=([^&]+)/);
      const identifier = urlMatch ? urlMatch[1] : null;
      
      if (!identifier) {
        console.error(`❌ URL dan identifier ajratib olinmadi: ${url}`);
        return;
      }

      // Navigate with retry logic
      await this.waitForNavigation(page, url);
      
      // Get minimal HTML content
      const htmlContent = await page.evaluate(() => {
        // Helper function to safely remove elements
        const removeElements = (selector) => {
          document.querySelectorAll(selector).forEach(el => {
            try {
              el.remove();
            } catch (e) {
              // Ignore errors if element can't be removed
            }
          });
        };
        
        // Remove unnecessary elements but keep important ones
        removeElements('script:not([type="application/ld+json"])'); // Keep structured data
        removeElements('style');
        removeElements('img');
        removeElements('svg');
        removeElements('video');
        removeElements('iframe');
        
        // Clean up the HTML
        const html = document.documentElement.outerHTML;
        return html
          .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim();
      });
      
      const Extension = require('../database/models/Extension');
      const extension = await Extension.findOne({
        where: { identifier: identifier }
      });
      
      if (!extension) {
        console.error(`❌ Extension bazada topilmadi: ${identifier}`);
        return;
      }
      
      const folderName = extension.name
        .replace(/\//g, ' ')
        .replace(/[\\:*?"<>|]/g, '_');
      const folderPath = path.join(savePath, folderName);
      
      try {
        const stats = await fs.stat(folderPath);
        if (stats.isDirectory()) {
          console.log(`⚠️ Folder mavjud: ${folderPath}`);
          return;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
      
      // Create folder first
      await fs.mkdir(folderPath, { recursive: true });

      // Then write files
      await Promise.all([
        fs.writeFile(path.join(folderPath, 'content.html'), htmlContent),
        fs.writeFile(
          path.join(folderPath, `${folderName}.url`),
          `[InternetShortcut]\nURL=${url}\n`,
          'utf8'
        )
      ]);
      
      // Update database
      await extension.update({ local_path: folderPath });
      
      console.log(`✅ Saqlandi: ${extension.name}`);
      
    } catch (error) {
      console.error(`❌ Fayllarni saqlashda xatolik: ${url}`, error);
      throw error; // Re-throw for retry handling
    } finally {
      if (ownPage && page) {
        try {
          await page.removeAllListeners(); // Clean up event listeners
          await page.close();
        } catch (e) {
          // Ignore page close errors
        }
      }
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

module.exports = new ExtensionScraper();
