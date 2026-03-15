require('dotenv').config();
const { Pool } = require('pg');
const logger = require('../utils/logger');

// Database configuration
const config = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_URL.includes('aivencloud.com')
    ? { rejectUnauthorized: false }
    : false,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 10000,
  max: 10,
  min: 2,
};

// Create connection pool
const pool = new Pool(config);

// Handle pool errors
pool.on('error', (err, client) => {
  logger.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Database connection class
class Database {
  constructor() {
    this.pool = pool;
  }

  // Test database connection
  async testConnection() {
    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW()');
      client.release();
      logger.info('Database connection successful');
      return { success: true, timestamp: result.rows[0].now };
    } catch (error) {
      logger.error('Database connection failed:', error);
      throw error;
    }
  }

  // Execute query with parameters
  async query(text, params = []) {
    const start = Date.now();

    try {
      const client = await this.pool.connect();
      const result = await client.query(text, params);
      client.release();

      const duration = Date.now() - start;
      logger.debug('Query executed', { text, duration, rows: result.rowCount });

      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error('Query failed', { text, duration, error: error.message });
      throw error;
    }
  }

  // Execute transaction
  async transaction(callback) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get single row
  async one(text, params = []) {
    const result = await this.query(text, params);
    return result.rows[0] || null;
  }

  // Get multiple rows
  async many(text, params = []) {
    const result = await this.query(text, params);
    return result.rows;
  }

  // Get single value
  async value(text, params = []) {
    const result = await this.one(text, params);
    if (result && Object.keys(result).length > 0) {
      return result[Object.keys(result)[0]];
    }
    return null;
  }

  // Check if record exists
  async exists(text, params = []) {
    const result = await this.value(text, params);
    return Boolean(result);
  }

  // Insert record and return ID
  async insert(table, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');

    const text = `
      INSERT INTO ${table} (${keys.join(', ')}) 
      VALUES (${placeholders}) 
      RETURNING *
    `;

    return await this.one(text, values);
  }

  // Update record
  async update(table, data, where, whereParams = []) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const setClause = keys.map((key, index) => `${key} = $${index + 1}`).join(', ');

    const text = `
      UPDATE ${table} 
      SET ${setClause} 
      WHERE ${where}
      RETURNING *
    `;

    return await this.one(text, [...values, ...whereParams]);
  }

  // Delete record
  async delete(table, where, params = []) {
    const text = `DELETE FROM ${table} WHERE ${where}`;
    const result = await this.query(text, params);
    return result.rowCount;
  }

  // Get pool stats
  getPoolStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  // Close all connections
  async close() {
    await this.pool.end();
    logger.info('Database connection pool closed');
  }

  // Health check
  async healthCheck() {
    try {
      const result = await this.query('SELECT 1 as health');
      const stats = this.getPoolStats();

      return {
        status: 'healthy',
        database: result.rows[0].health === 1,
        pool: stats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Run migrations
  async runMigrations() {
    try {
      // Create migrations table if it doesn't exist
      await this.query(`
        CREATE TABLE IF NOT EXISTS migrations (
          id SERIAL PRIMARY KEY,
          filename VARCHAR(255) NOT NULL UNIQUE,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Get migration files
      const fs = require('fs');
      const path = require('path');
      // Resolve migrations path more robustly for Vercel
      const migrationsDir = process.env.VERCEL 
        ? path.join(process.cwd(), 'backend/database/migrations')
        : path.join(__dirname, '../../database/migrations');

      if (!fs.existsSync(migrationsDir)) {
        logger.info(`No migrations directory found at: ${migrationsDir}`);
        return;
      }

      const migrationFiles = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort();

      // Get executed migrations
      const executedMigrations = await this.many(
        'SELECT filename FROM migrations ORDER BY filename'
      );
      const executedFiles = executedMigrations.map(m => m.filename);

      // Run pending migrations
      for (const file of migrationFiles) {
        if (!executedFiles.includes(file)) {
          logger.info(`Running migration: ${file}`);

          const migrationSQL = fs.readFileSync(
            path.join(migrationsDir, file),
            'utf8'
          );

          await this.transaction(async (client) => {
            await client.query(migrationSQL);
            await client.query(
              'INSERT INTO migrations (filename) VALUES ($1)',
              [file]
            );
          });

          logger.info(`Migration completed: ${file}`);
        }
      }

      logger.info('All migrations are up to date');
    } catch (error) {
      logger.error('Migration failed:', error);
      throw error;
    }
  }

  // Seed database
  async seedDatabase() {
    try {
      const fs = require('fs');
      const path = require('path');
      const seedFile = path.join(__dirname, '../../database/seeds/seed_data.sql');

      if (!fs.existsSync(seedFile)) {
        logger.info('No seed file found');
        return;
      }

      logger.info('Running database seed...');

      const seedSQL = fs.readFileSync(seedFile, 'utf8');
      await this.query(seedSQL);

      logger.info('Database seeded successfully');
    } catch (error) {
      logger.error('Database seeding failed:', error);
      throw error;
    }
  }
}

// Create and export database instance
const database = new Database();

module.exports = database;
