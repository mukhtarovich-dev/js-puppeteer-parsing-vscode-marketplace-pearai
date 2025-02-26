require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Sequelize } = require('sequelize');
const path = require('path');

// Define the path for the SQLite database file
const dbPath = path.join(__dirname, '../../data/vscode_extensions.sqlite');

// Create Sequelize instance with SQLite and optimized settings
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false,
  pool: {
    max: 25, // Maximum number of connection instances
    min: 0,
    acquire: 60000, // Maximum time (ms) that pool will try to get connection before throwing error
    idle: 10000 // Maximum time (ms) that a connection can be idle before being released
  },
  dialectOptions: {
    // SQLite specific options
    pragma: {
      'journal_mode': 'WAL', // Write-Ahead Logging for better concurrency
      'synchronous': 'NORMAL', // Faster than FULL, still safe
      'cache_size': -64000, // 64MB cache size (-ve number means kibibytes)
      'foreign_keys': 1,
      'temp_store': 'MEMORY' // Store temp tables in memory
    }
  }
});

// Test the connection
const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('SQLite bazasiga muvaffaqiyatli ulandi');
    
    // Sync the models with the database
    await sequelize.sync();
    console.log('Database jadvallar sinxronlashtirildi');
  } catch (error) {
    console.error('SQLite bazasiga ulanishda xatolik:', error.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };