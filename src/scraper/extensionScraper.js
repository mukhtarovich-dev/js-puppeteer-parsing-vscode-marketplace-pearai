const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class ExtensionScraper {
  async initialize() {
    this.browser = await puppeteer.launch({
      headless: "new",  // "new" headless mode
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
  }

  async scrapeExtensionsToDb() {
    try {
      const page = await this.browser.newPage();
      
      await page.setDefaultNavigationTimeout(120000);
      await page.setDefaultTimeout(60000);
      
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      const sortOptions = [
        'Installs',
        'Rating',
        'PublisherCount',
        'UpdatedDate',
        'ReleaseDate',
        'Name'
      ];
      
      const processedUrls = new Set();
      let totalProcessed = 0;
      
      for (const sortOption of sortOptions) {
        console.log(`\n=== ${sortOption} bo'yicha qidirilmoqda ===\n`);
        
        const url = `https://marketplace.visualstudio.com/search?target=VSCode&category=All%20categories&sortBy=${sortOption}`;
        console.log(`VSCode Marketplace sahifasiga o'tilmoqda: ${url}`);
        
        await page.goto(url, {
          waitUntil: 'networkidle0'
        });
        
        console.log('Sahifa elementlari yuklanishini kutish...');
        await page.waitForSelector('.item-list-container', { timeout: 80000 });
        
        let scrollCount = 0;
        const maxScrolls = 200;
        let consecutiveEmptyScrolls = 0;
        
        const extractUrls = async () => {
          return await page.evaluate(() => {
            const selectors = [
              '.item-grid-container .row-item a',
              '.item-list-container .row-item a',
              '.gallery-item-card-container a',
              '.ux-item-card a',
              '.item-grid-container a[href*="/items"]',
              '.item-list-container a[href*="/items"]'
            ];
            
            const urls = new Set();
            
            for (const selector of selectors) {
              const elements = document.querySelectorAll(selector);
              for (const element of elements) {
                if (element.href && element.href.includes('/items?itemName=')) {
                  urls.add(element.href);
                }
              }
            }
            
            return Array.from(urls);
          });
        };
        
        let newUrls = await extractUrls();
        console.log(`Dastlabki URLlar soni: ${newUrls.length}`);
        
        for (const url of newUrls) {
          if (!processedUrls.has(url)) {
            processedUrls.add(url);
            console.log(`Murojaat qilinmoqda: ${url}`);
            await this.scrapeAndSaveToDb(url);
            totalProcessed++;
          }
        }
        
        while (scrollCount < maxScrolls && consecutiveEmptyScrolls < 8) {
          scrollCount++;
          console.log(`Sahifani pastga siljitish... (${scrollCount}/${maxScrolls})`);
          
          await page.evaluate(() => {
            window.scrollBy(0, window.innerHeight * 5);
          });
          
          await page.evaluate(() => {
            return new Promise(resolve => setTimeout(resolve, 5000));
          });
          
          newUrls = await extractUrls();
          
          const unprocessedUrls = newUrls.filter(url => !processedUrls.has(url));
          console.log(`Yangi topilgan URLlar: ${unprocessedUrls.length}`);
          
          if (unprocessedUrls.length === 0) {
            consecutiveEmptyScrolls++;
            console.log(`Yangi URL topilmadi (${consecutiveEmptyScrolls}/8), davom etilmoqda...`);
          } else {
            consecutiveEmptyScrolls = 0;
            
            for (const url of unprocessedUrls) {
              processedUrls.add(url);
              console.log(`Murojaat qilinmoqda: ${url}`);
              await this.scrapeAndSaveToDb(url);
              totalProcessed++;
            }
            
            console.log(`Jami qayta ishlangan URLlar: ${totalProcessed}`);
          }
        }
        
        if (consecutiveEmptyScrolls >= 8) {
          console.log(`Ketma-ket 8 marta yangi URL topilmadi, keyingi saralash usuliga o'tilmoqda...`);
        } else if (scrollCount >= maxScrolls) {
          console.log(`Maksimal scroll miqdoriga yetildi, keyingi saralash usuliga o'tilmoqda...`);
        }
      }
      
      console.log(`\n=== YAKUNIY NATIJA ===`);
      console.log(`Jami topilgan va qayta ishlangan URLlar: ${totalProcessed}`);
      return totalProcessed;
    } catch (error) {
      console.error('Scraping xatosi:', error);
      throw error;
    }
  }

  async scrapeAndSaveToDb(url) {
    try {
      const urlMatch = url.match(/itemName=([^&]+)/);
      const identifier = urlMatch ? urlMatch[1] : null;
      
      if (!identifier) {
        console.error(`❌ URL dan identifier ajratib olinmadi: ${url}`);
        return;
      }
      
      const Extension = require('../database/models/Extension');
      const existingExtension = await Extension.findOne({
        where: { identifier: identifier }
      });
      
      if (existingExtension) {
        console.log(`⚠️ Extension bazada mavjud: ${existingExtension.name} (${identifier})`);
        return;
      }
      
      const page = await this.browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle0' });
      
      const extensionData = await page.evaluate((pageUrl) => {
        const getText = (selector) => {
          const element = document.querySelector(selector);
          return element ? element.textContent.trim() : '';
        };
        
        const getNumber = (selector) => {
          const text = getText(selector);
          return text ? parseInt(text.replace(/[^0-9]/g, '')) : 0;
        };
        
        const getArray = (selector) => {
          const elements = document.querySelectorAll(selector);
          return Array.from(elements).map(el => el.textContent.trim());
        };
        
        const getIdentifier = () => {
          const url = window.location.href;
          const match = url.match(/itemName=([^&]+)/);
          return match ? match[1] : '';
        };
        
        return {
          name: getText('h1[itemprop="name"]') || getText('.ux-item-name'),
          identifier: getIdentifier(),
          description: getText('.ux-item-shortdesc') || getText('.ux-item-description'),
          version: getText('.ux-item-meta-version') || getText('#version + td'),
          author: getText('.ux-item-publisher') || getText('#publisher + td'),
          url: pageUrl,
          downloads: getNumber('.ux-item-meta-installs') || getNumber('.installs'),
          installs: getNumber('.installs-text') || getNumber('.installs'),
          last_updated: getText('.extension-last-updated-date') || getText('#last-updated + td'),
          categories: getArray('.meta-data-list-link'),
          rating: parseFloat(getText('.ux-item-rating-count') || getText('.rating')) || 0,
          reviewCount: $(".ux-item-rating-count span").first().text().trim(),
          tags: getArray('.meta-data-list'),
          repository: getText('.ux-repository'),
          licenseUrl : $('.ux-section-resources a').filter((_, el) => $(el).text().trim() === "License").attr("href")
        };
      }, url);
      
      await page.close();
      
      await this.saveToDatabase(extensionData);
      
      console.log(`✅ Saqlandi: ${extensionData.name} (${url})`);
      
    } catch (error) {
      console.error(`❌ Ma'lumotlarni saqlashda xatolik: ${url}`, error);
    }
  }

  async saveExtensionContent(url, savePath) {
    try {
      const urlMatch = url.match(/itemName=([^&]+)/);
      const identifier = urlMatch ? urlMatch[1] : null;
      
      if (!identifier) {
        console.error(`❌ URL dan identifier ajratib olinmadi: ${url}`);
        return;
      }
      
      const page = await this.browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle0' });
      
      const htmlContent = await page.evaluate(() => document.documentElement.outerHTML);
      
      const Extension = require('../database/models/Extension');
      const extension = await Extension.findOne({
        where: { identifier: identifier }
      });
      
      if (!extension) {
        console.error(`❌ Extension bazada topilmadi: ${identifier}`);
        return;
      }
      
      // Create folder name based on extension name with regex sanitization
      const folderName = extension.name
        .replace(/\//g, ' ')
        .replace(/[\\:*?"<>|]/g, '_');
      const folderPath = path.join(savePath, folderName);
      
      // Check if folder already exists
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
      
      // Save to file system
      await fs.mkdir(folderPath, { recursive: true });
      await fs.writeFile(path.join(folderPath, 'content.html'), htmlContent);
      
      // Create a Windows-compatible .url shortcut file
      const urlFilePath = path.join(folderPath, `${folderName}.url`);
      await fs.writeFile(urlFilePath, `[InternetShortcut]\nURL=${url}\n`, 'utf8');
      
      // Update local_path in database
      await extension.update({ local_path: folderPath });
      
      console.log(`✅ Saqlandi: ${extension.name}`);
      console.log(`🔗 URL fayl saqlandi: ${urlFilePath}`);
      
      await page.close();
      
    } catch (error) {
      console.error(`❌ Fayllarni saqlashda xatolik: ${url}`, error);
    }
  }

  async saveToDatabase(extensionData) {
    try {
      const Extension = require('../database/models/Extension');
      
      let lastUpdated = null;
      if (extensionData.last_updated) {
        try {
          lastUpdated = new Date(extensionData.last_updated);
          if (isNaN(lastUpdated.getTime())) {
            lastUpdated = null;
          }
        } catch (e) {
          lastUpdated = null;
        }
      }
      
      const data = {
        name: extensionData.name || null,
        identifier: extensionData.identifier || null,
        description: extensionData.description || null,
        version: extensionData.version || null,
        author: extensionData.author || null,
        url: extensionData.url || null,
        downloads: extensionData.downloads || null,
        installs: extensionData.installs || null,
        last_updated: lastUpdated,
        categories: extensionData.categories && extensionData.categories.length > 0 ? extensionData.categories : null,
        rating: extensionData.rating || null,
        review_count: extensionData.review_count || null,
        tags: extensionData.tags && extensionData.tags.length > 0 ? extensionData.tags : null,
        repository: extensionData.repository || null,
        license: extensionData.license || null,
        local_path: null // Initially null, will be updated when files are saved
      };
      
      if (!data.identifier) {
        console.error(`❌ Identifier is missing for extension: ${extensionData.name}`);
        return null;
      }
      
      console.log('Attempting to save to SQLite:', data.name);
      
      const [extension, created] = await Extension.findOrCreate({
        where: { identifier: data.identifier },
        defaults: data
      });
      
      if (!created) {
        await extension.update(data);
      }
      
      console.log(`✅ ${extensionData.name} ma'lumotlari SQLite bazasiga saqlandi`);
      return extension;
    } catch (error) {
      console.error(`❌ SQLite bazasiga saqlashda xatolik:`, error);
      console.error('Error stack:', error?.stack);
      return null;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

module.exports = new ExtensionScraper();
