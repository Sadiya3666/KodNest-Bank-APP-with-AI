const database = require('../config/database');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

class BankUserModel {
  constructor() {
    this.tableName = 'BankUser';
    this.saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
  }

  // Create new user
  async create(userData) {
    try {
      const { name, email, password } = userData;

      // Hash password
      const hashedPassword = await bcrypt.hash(password, this.saltRounds);

      const query = `
        INSERT INTO ${this.tableName} (name, email, password, balance) 
        VALUES ($1, $2, $3, $4) 
        RETURNING customer_id, name, email, balance, created_at, updated_at
      `;

      const result = await database.query(query, [name, email, hashedPassword, 0.00]);

      logger.info('User created successfully', {
        customer_id: result.rows[0].customer_id,
        email
      });

      return result.rows[0];
    } catch (error) {
      logger.error('User creation failed:', error);

      // Handle unique constraint violation
      if (error.code === '23505') {
        throw new Error('Email already exists');
      }

      throw error;
    }
  }

  // Find user by email
  async findByEmail(email) {
    try {
      const query = `
        SELECT customer_id, name, email, password, balance, created_at, updated_at 
        FROM ${this.tableName} 
        WHERE email = $1
      `;

      const result = await database.query(query, [email]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Find user by email failed:', error);
      throw error;
    }
  }

  // Find user by ID (including password for debug/educational purposes)
  async findFullById(customerId) {
    try {
      const query = `
        SELECT customer_id, name, email, password, balance, created_at, updated_at 
        FROM ${this.tableName} 
        WHERE customer_id = $1
      `;

      const result = await database.query(query, [customerId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Find full user by ID failed:', error);
      throw error;
    }
  }

  // Find user by ID
  async findById(customerId) {
    try {
      const query = `
        SELECT customer_id, name, email, balance, created_at, updated_at 
        FROM ${this.tableName} 
        WHERE customer_id = $1
      `;

      const result = await database.query(query, [customerId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Find user by ID failed:', error);
      throw error;
    }
  }

  // Validate user password
  async validatePassword(email, password) {
    try {
      const user = await this.findByEmail(email);

      if (!user) {
        return null;
      }

      const isValidPassword = await bcrypt.compare(password, user.password);

      if (!isValidPassword) {
        return null;
      }

      // Remove password from returned object
      const { password: _, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      logger.error('Password validation failed:', error);
      throw error;
    }
  }

  // Update user balance
  async updateBalance(customerId, newBalance) {
    try {
      const query = `
        UPDATE ${this.tableName} 
        SET balance = $2, updated_at = CURRENT_TIMESTAMP 
        WHERE customer_id = $1 
        RETURNING customer_id, name, email, balance, updated_at
      `;

      const result = await database.query(query, [customerId, newBalance]);

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      logger.info('Balance updated', {
        customer_id: customerId,
        new_balance: newBalance
      });

      return result.rows[0];
    } catch (error) {
      logger.error('Balance update failed:', error);
      throw error;
    }
  }

  // Get user balance
  async getBalance(customerId) {
    try {
      const query = `
        SELECT balance 
        FROM ${this.tableName} 
        WHERE customer_id = $1
      `;

      const result = await database.query(query, [customerId]);

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      return parseFloat(result.rows[0].balance);
    } catch (error) {
      logger.error('Get balance failed:', error);
      throw error;
    }
  }

  // Check if user has sufficient balance
  async hasSufficientBalance(customerId, amount) {
    try {
      const balance = await this.getBalance(customerId);
      return balance >= amount;
    } catch (error) {
      logger.error('Balance check failed:', error);
      return false;
    }
  }

  // Update user profile
  async updateProfile(customerId, updateData) {
    try {
      const { name, email } = updateData;
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (name) {
        updates.push(`name = $${paramIndex++}`);
        values.push(name);
      }

      if (email) {
        updates.push(`email = $${paramIndex++}`);
        values.push(email);
      }

      if (updates.length === 0) {
        throw new Error('No update data provided');
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(customerId);

      const query = `
        UPDATE ${this.tableName} 
        SET ${updates.join(', ')} 
        WHERE customer_id = $${paramIndex} 
        RETURNING customer_id, name, email, balance, created_at, updated_at
      `;

      const result = await database.query(query, values);

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      logger.info('User profile updated', {
        customer_id: customerId,
        updates: Object.keys(updateData)
      });

      return result.rows[0];
    } catch (error) {
      logger.error('Profile update failed:', error);

      if (error.code === '23505') {
        throw new Error('Email already exists');
      }

      throw error;
    }
  }

  // Delete user (soft delete by setting balance to 0 and marking as inactive)
  async deleteUser(customerId) {
    try {
      await database.transaction(async (client) => {
        // Delete user's JWT tokens
        await client.query(
          'DELETE FROM BankUserJwt WHERE customer_id = $1',
          [customerId]
        );

        // Set user balance to 0 (or implement soft delete with status field)
        await client.query(
          'UPDATE BankUser SET balance = 0 WHERE customer_id = $1',
          [customerId]
        );
      });

      logger.info('User deleted', { customer_id: customerId });
      return true;
    } catch (error) {
      logger.error('User deletion failed:', error);
      throw error;
    }
  }

  // Get all users (admin function)
  async getAllUsers(limit = 50, offset = 0) {
    try {
      const query = `
        SELECT customer_id, name, email, balance, created_at, updated_at 
        FROM ${this.tableName} 
        ORDER BY created_at DESC 
        LIMIT $1 OFFSET $2
      `;

      const result = await database.query(query, [limit, offset]);
      return result.rows;
    } catch (error) {
      logger.error('Get all users failed:', error);
      throw error;
    }
  }

  // Get user count
  async getUserCount() {
    try {
      const query = `SELECT COUNT(*) as count FROM ${this.tableName}`;
      const result = await database.query(query);
      return parseInt(result.rows[0].count);
    } catch (error) {
      logger.error('Get user count failed:', error);
      throw error;
    }
  }

  // Search users by name or email
  async searchUsers(searchTerm, limit = 20) {
    try {
      const query = `
        SELECT customer_id, name, email, balance, created_at 
        FROM ${this.tableName} 
        WHERE name ILIKE $1 OR email ILIKE $1 
        ORDER BY name 
        LIMIT $2
      `;

      const result = await database.query(query, [`%${searchTerm}%`, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Search users failed:', error);
      throw error;
    }
  }

  // Get users created within date range
  async getUsersByDateRange(startDate, endDate) {
    try {
      const query = `
        SELECT customer_id, name, email, balance, created_at 
        FROM ${this.tableName} 
        WHERE created_at BETWEEN $1 AND $2 
        ORDER BY created_at DESC
      `;

      const result = await database.query(query, [startDate, endDate]);
      return result.rows;
    } catch (error) {
      logger.error('Get users by date range failed:', error);
      throw error;
    }
  }

  // Update password
  async updatePassword(customerId, newPassword) {
    try {
      const hashedPassword = await bcrypt.hash(newPassword, this.saltRounds);

      const query = `
        UPDATE ${this.tableName} 
        SET password = $2, updated_at = CURRENT_TIMESTAMP 
        WHERE customer_id = $1 
        RETURNING customer_id, name, email
      `;

      const result = await database.query(query, [customerId, hashedPassword]);

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      logger.info('Password updated', { customer_id: customerId });
      return result.rows[0];
    } catch (error) {
      logger.error('Password update failed:', error);
      throw error;
    }
  }

  // Get user statistics
  async getUserStatistics(customerId) {
    try {
      const query = `
        SELECT 
          u.customer_id,
          u.name,
          u.email,
          u.balance,
          u.created_at,
          u.updated_at,
          COUNT(t.transaction_id) as total_transactions,
          COALESCE(SUM(CASE WHEN t.transaction_type = 'deposit' THEN t.amount ELSE 0 END), 0) as total_deposits,
          COALESCE(SUM(CASE WHEN t.transaction_type = 'withdrawal' THEN t.amount ELSE 0 END), 0) as total_withdrawals,
          COALESCE(SUM(CASE WHEN t.transaction_type = 'transfer' AND t.from_customer_id = u.customer_id THEN t.amount ELSE 0 END), 0) as total_sent,
          COALESCE(SUM(CASE WHEN t.transaction_type = 'transfer' AND t.to_customer_id = u.customer_id THEN t.amount ELSE 0 END), 0) as total_received
        FROM ${this.tableName} u
        LEFT JOIN Transactions t ON (t.from_customer_id = u.customer_id OR t.to_customer_id = u.customer_id)
        WHERE u.customer_id = $1
        GROUP BY u.customer_id, u.name, u.email, u.balance, u.created_at, u.updated_at
      `;

      const result = await database.query(query, [customerId]);

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Get user statistics failed:', error);
      throw error;
    }
  }

  // Check if user exists
  async userExists(customerId) {
    try {
      const query = `SELECT 1 FROM ${this.tableName} WHERE customer_id = $1`;
      const result = await database.query(query, [customerId]);
      return result.rows.length > 0;
    } catch (error) {
      logger.error('User existence check failed:', error);
      return false;
    }
  }

  // Check if email exists
  async emailExists(email) {
    try {
      const query = `SELECT 1 FROM ${this.tableName} WHERE email = $1`;
      const result = await database.query(query, [email]);
      return result.rows.length > 0;
    } catch (error) {
      logger.error('Email existence check failed:', error);
      return false;
    }
  }
}

module.exports = new BankUserModel();
