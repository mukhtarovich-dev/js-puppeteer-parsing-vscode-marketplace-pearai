#!/usr/bin/env node
const ExtensionScraper = require('../scraper/extensionScraper');
const { connectDB } = require('../config/database');
const Extension = require('../database/models/Extension');

const main = async () => {
  try {
    // Connect to SQLite database
    console.log('SQLite bazasiga ulanish...');
    await connectDB();
    
    // Force sync the model with the database to ensure table exists
    console.log('Database jadvallarini yaratish...');
    await Extension.sync({ alter: true });
    console.log('Database jadvallar yaratildi');
    
    console.log('VSCode Extension scraping boshlandi...');
    await ExtensionScraper.initialize();
    
    await ExtensionScraper.scrapeExtensionsToDb();
    
    await ExtensionScraper.close();
    console.log('Scraping muvaffaqiyatli yakunlandi!');
    process.exit(0);
  } catch (error) {
    console.error('Xatolik yuz berdi:', error);
    process.exit(1);
  }
};

main();