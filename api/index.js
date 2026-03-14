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

  // Ensure database tables exist (Run migrations on first request)
  if (!isInitialized) {
    try {
      console.log('Production initialization: checking database...');
      // Test connection
      await database.testConnection();
      
      // We run migrations automatically to ensure tables exist
      // In production, we usually check a flag or just run them (they are idempotent)
      if (process.env.RUN_MIGRATIONS === 'true' || process.env.NODE_ENV === 'production') {
        console.log('Running automatic migrations...');
        await database.runMigrations();
      }
      
      isInitialized = true;
      console.log('Initialization complete.');
    } catch (error) {
      console.error('Initialization failed:', error);
      // We don't mark as initialized so it retries on next request
    }
  }
  
  // Forward the request to the Express app
  return app(req, res);
};
