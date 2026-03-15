const app = require('../backend/src/app');
const database = require('../backend/src/config/database');

// Track if initialization has been done
let isInitialized = false;

// Handle Vercel serverless function
module.exports = async (req, res) => {
  // Set CORS headers for serverless environment
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Ensure database is ready
  if (!isInitialized) {
    try {
      if (process.env.RUN_MIGRATIONS === 'true') {
        console.log('Production initialization: running migrations...');
        await database.runMigrations();
      } else {
        await database.testConnection();
      }
      isInitialized = true;
    } catch (error) {
      console.error('Initialization warning (continuing...):', error.message);
      // Don't block the actual request
    }
  }
  
  // Forward the request to the Express app
  return app(req, res);
};
