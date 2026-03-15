const app = require('../backend/src/app');
const database = require('../backend/src/config/database');

// Track if initialization has been done
let isInitialized = false;

// Handle Vercel serverless function
module.exports = async (req, res) => {
  // FORCE CORS HEADERS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Ensure database is ready (Lazy initialization)
  if (!isInitialized) {
    try {
      if (process.env.RUN_MIGRATIONS === 'true') {
        console.log('Production initialization: running migrations...');
        await database.runMigrations();
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
