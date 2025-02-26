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
    
    console.log(`${extensions.length} ta extension topildi`);
    
    // Process each extension
    for (const extension of extensions) {
      console.log(`Processing: ${extension.name} (${extension.url})`);
      await ExtensionScraper.saveExtensionContent(extension.url, absolutePath);
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