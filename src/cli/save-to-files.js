#!/usr/bin/env node
const ExtensionScraper = require('../scraper/extensionScraper');
const { connectDB } = require('../config/database');
const Extension = require('../database/models/Extension');
const path = require('path');
const fs = require('fs').promises;

// Argumentlarni olish
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Xatolik: Saqlash joyini ko\'rsating!');
  console.log('Ishlatish: save-to-files <saqlash_joyi>');
  console.log('Misol: save-to-files C:\\VSCodeExtensions');
  process.exit(1);
}

const savePath = args[0];

// Concurrent processing configuration
const BATCH_SIZE = 2; // Reduced from 3 to 2
const EXTENSIONS_PER_BATCH = 3; // Reduced from 5 to 3
const BATCH_DELAY = 3000; // 3 seconds delay between batches

async function processBatch(extensions, absolutePath, browser) {
  const pages = await Promise.all(
    Array(BATCH_SIZE).fill().map(async () => {
      const page = await browser.newPage();
      await ExtensionScraper.optimizePage(page);
      return page;
    })
  );

  try {
    for (let i = 0; i < extensions.length; i += EXTENSIONS_PER_BATCH) {
      const batchExtensions = extensions.slice(i, i + EXTENSIONS_PER_BATCH);
      
      await Promise.all(
        batchExtensions.map(async (extension, index) => {
          const page = pages[index % pages.length];
          let retries = 3;
          let lastError = null;
          
          while (retries > 0) {
            try {
              await ExtensionScraper.saveExtensionContent(extension.url, absolutePath, page);
              break;
            } catch (error) {
              lastError = error;
              retries--;
              if (retries === 0) {
                console.error(`❌ ${extension.url} uchun urinishlar tugadi:`, error.message);
                return { url: extension.url, error: error.message };
              } else {
                console.log(`⚠️ Qayta urinish (${retries} ta urinish qoldi): ${extension.url}`);
                // Exponential backoff
                await new Promise(resolve => setTimeout(resolve, (3 - retries) * 2000));
              }
            }
          }
          return null;
        })
      );
      
      // Delay between sub-batches
      if (i + EXTENSIONS_PER_BATCH < extensions.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }
  } finally {
    await Promise.all(pages.map(page => page.close()));
  }
}

const main = async () => {
  try {
    // Ensure data directory exists
    const dataDir = path.join(__dirname, '../../data');
    try {
      await fs.access(dataDir);
    } catch {
      console.log('Data papkasi mavjud emas. Yaratilmoqda...');
      await fs.mkdir(dataDir, { recursive: true });
    }

    // Connect to SQLite database
    console.log('SQLite bazasiga ulanish...');
    await connectDB();
    
    // Saqlash joyini tekshirish
    const absolutePath = path.resolve(savePath);
    console.log(`Saqlash joyi: ${absolutePath}`);
    
    // Papka mavjudligini tekshirish
    try {
      await fs.access(absolutePath);
    } catch {
      console.log('Ko\'rsatilgan papka mavjud emas. Yaratilmoqda...');
      await fs.mkdir(absolutePath, { recursive: true });
    }
    
    console.log('VSCode Extension scraping boshlandi...');
    await ExtensionScraper.initialize();
    
    // Get all extensions from database that don't have local_path
    const extensions = await Extension.findAll({
      where: {
        local_path: null
      }
    });
    
    const totalExtensions = extensions.length;
    console.log(`${totalExtensions} ta extension topildi`);
    
    if (totalExtensions === 0) {
      console.log('Yangi extension topilmadi');
      await ExtensionScraper.close();
      process.exit(0);
    }

    // Process extensions in batches
    let processedCount = 0;
    const startTime = Date.now();
    const failedUrls = [];

    for (let i = 0; i < extensions.length; i += BATCH_SIZE * EXTENSIONS_PER_BATCH) {
      const batchExtensions = extensions.slice(i, i + BATCH_SIZE * EXTENSIONS_PER_BATCH);
      const batchResults = await processBatch(batchExtensions, absolutePath, ExtensionScraper.browser);
      
      // Track failed URLs
      if (batchResults) {
        batchResults.forEach(result => {
          if (result && result.error) {
            failedUrls.push({ url: result.url, error: result.error });
          }
        });
      }
      
      processedCount += batchExtensions.length;
      const progress = (processedCount / totalExtensions * 100).toFixed(2);
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = (processedCount / elapsed).toFixed(2);
      
      console.log(`Progress: ${progress}% (${processedCount}/${totalExtensions}) - ${speed} extensions/second`);
      
      // Delay between main batches
      if (i + BATCH_SIZE * EXTENSIONS_PER_BATCH < extensions.length) {
        const delay = 5000; // 5 seconds between main batches
        console.log(`⏳ Keyingi batch uchun ${delay/1000} sekund kutilmoqda...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\nJami vaqt: ${totalTime} sekund`);
    console.log(`O'rtacha tezlik: ${(totalExtensions / totalTime).toFixed(2)} extensions/second`);
    
    if (failedUrls.length > 0) {
      console.log('\nMuvaffaqiyatsiz URLlar:');
      failedUrls.forEach(({url, error}) => console.log(`- ${url}: ${error}`));
      console.log(`\nJami ${failedUrls.length} ta URL muvaffaqiyatsiz yakunlandi`);
    }
    
    await ExtensionScraper.close();
    console.log('Scraping muvaffaqiyatli yakunlandi!');
    process.exit(0);
  } catch (error) {
    console.error('Xatolik yuz berdi:', error);
    process.exit(1);
  }
};

main();