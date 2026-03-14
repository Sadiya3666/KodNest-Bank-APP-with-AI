const bcrypt = require('bcryptjs');
const logger = require('./logger');

class PasswordHash {
  constructor() {
    this.saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
  }

  // Hash password
  async hash(password) {
    try {
      if (!password || typeof password !== 'string') {
        throw new Error('Password must be a non-empty string');
      }

      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters long');
      }

      const hashedPassword = await bcrypt.hash(password, this.saltRounds);
      
      logger.debug('Password hashed successfully');
      return hashedPassword;
    } catch (error) {
      logger.error('Password hashing failed:', error);
      throw error;
    }
  }

  // Compare password with hash
  async compare(password, hashedPassword) {
    try {
      if (!password || !hashedPassword) {
        throw new Error('Password and hashed password are required');
      }

      if (typeof password !== 'string' || typeof hashedPassword !== 'string') {
        throw new Error('Password and hashed password must be strings');
      }

      const isMatch = await bcrypt.compare(password, hashedPassword);
      
      logger.debug('Password comparison completed', { match: isMatch });
      return isMatch;
    } catch (error) {
      logger.error('Password comparison failed:', error);
      throw error;
    }
  }

  // Validate password strength
  validateStrength(password) {
    try {
      const errors = [];

      if (!password) {
        errors.push('Password is required');
        return { valid: false, errors };
      }

      if (typeof password !== 'string') {
        errors.push('Password must be a string');
        return { valid: false, errors };
      }

      // Length validation
      if (password.length < 8) {
        errors.push('Password must be at least 8 characters long');
      }

      if (password.length > 128) {
        errors.push('Password must be less than 128 characters');
      }

      // Character type validations
      if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
      }

      if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
      }

      if (!/\d/.test(password)) {
        errors.push('Password must contain at least one number');
      }

      if (!/[@$!%*?&]/.test(password)) {
        errors.push('Password must contain at least one special character (@$!%*?&)');
      }

      // Common patterns to avoid
      if (/^[a-zA-Z]+$/.test(password)) {
        errors.push('Password cannot contain only letters');
      }

      if (/^\d+$/.test(password)) {
        errors.push('Password cannot contain only numbers');
      }

      // Check for common weak passwords
      const commonPasswords = [
        'password', '12345678', 'qwerty123', 'admin123', 'password123',
        '123456789', 'abc12345', 'password1', '1234567890', 'qwerty'
      ];

      if (commonPasswords.includes(password.toLowerCase())) {
        errors.push('Password is too common. Please choose a stronger password');
      }

      // Check for sequential characters
      if (this.hasSequentialChars(password)) {
        errors.push('Password should not contain sequential characters');
      }

      // Check for repeated characters
      if (this.hasRepeatedChars(password)) {
        errors.push('Password should not contain too many repeated characters');
      }

      const isValid = errors.length === 0;
      
      return {
        valid: isValid,
        errors: errors,
        strength: isValid ? this.calculateStrength(password) : 'weak'
      };
    } catch (error) {
      logger.error('Password strength validation failed:', error);
      throw error;
    }
  }

  // Calculate password strength
  calculateStrength(password) {
    try {
      let score = 0;

      // Length bonus
      if (password.length >= 8) score += 1;
      if (password.length >= 12) score += 1;
      if (password.length >= 16) score += 1;

      // Character variety bonus
      if (/[a-z]/.test(password)) score += 1;
      if (/[A-Z]/.test(password)) score += 1;
      if (/\d/.test(password)) score += 1;
      if (/[@$!%*?&]/.test(password)) score += 1;
      if (/[^a-zA-Z0-9@$!%*?&]/.test(password)) score += 1; // Other special chars

      // Complexity bonus
      if (this.hasMixedCase(password)) score += 1;
      if (this.hasNumbersAndLetters(password)) score += 1;
      if (this.hasSpecialChars(password)) score += 1;

      // Deduct for weak patterns
      if (this.hasSequentialChars(password)) score -= 1;
      if (this.hasRepeatedChars(password)) score -= 1;

      // Convert score to strength level
      if (score <= 2) return 'weak';
      if (score <= 4) return 'medium';
      if (score <= 6) return 'strong';
      return 'very_strong';
    } catch (error) {
      logger.error('Password strength calculation failed:', error);
      return 'weak';
    }
  }

  // Check for sequential characters
  hasSequentialChars(password) {
    const sequences = [
      '0123456789', '9876543210',
      'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba',
      'qwertyuiop', 'asdfghjkl', 'zxcvbnm'
    ];

    const lowerPassword = password.toLowerCase();

    for (const sequence of sequences) {
      for (let i = 0; i <= sequence.length - 3; i++) {
        const subsequence = sequence.substring(i, i + 3);
        if (lowerPassword.includes(subsequence)) {
          return true;
        }
      }
    }

    return false;
  }

  // Check for repeated characters
  hasRepeatedChars(password) {
    // Check for 3 or more consecutive identical characters
    return /(.)\1\1/.test(password);
  }

  // Check for mixed case
  hasMixedCase(password) {
    return /[a-z]/.test(password) && /[A-Z]/.test(password);
  }

  // Check for numbers and letters
  hasNumbersAndLetters(password) {
    return /\d/.test(password) && /[a-zA-Z]/.test(password);
  }

  // Check for special characters
  hasSpecialChars(password) {
    return /[^a-zA-Z0-9]/.test(password);
  }

  // Generate secure random password
  generatePassword(length = 12, options = {}) {
    try {
      const {
        includeUppercase = true,
        includeLowercase = true,
        includeNumbers = true,
        includeSpecialChars = true,
        excludeSimilar = true,
        excludeAmbiguous = true
      } = options;

      let charset = '';
      
      if (includeLowercase) {
        charset += excludeSimilar ? 'abcdefghijkmnpqrstuvwxyz' : 'abcdefghijklmnopqrstuvwxyz';
      }
      
      if (includeUppercase) {
        charset += excludeSimilar ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      }
      
      if (includeNumbers) {
        charset += excludeSimilar ? '23456789' : '0123456789';
      }
      
      if (includeSpecialChars) {
        charset += excludeAmbiguous ? '!@#$%^&*' : '!@#$%^&*()_+-=[]{}|;:,.<>?';
      }

      if (!charset) {
        throw new Error('At least one character type must be included');
      }

      let password = '';
      const crypto = require('crypto');
      
      for (let i = 0; i < length; i++) {
        const randomIndex = crypto.randomInt(0, charset.length);
        password += charset[randomIndex];
      }

      // Ensure password meets minimum requirements
      const validation = this.validateStrength(password);
      if (!validation.valid) {
        // Try again if generated password doesn't meet requirements
        return this.generatePassword(length, options);
      }

      return password;
    } catch (error) {
      logger.error('Password generation failed:', error);
      throw error;
    }
  }

  // Check if password needs to be rehashed (for algorithm upgrades)
  async needsRehash(hashedPassword) {
    try {
      return await bcrypt.getRounds(hashedPassword) < this.saltRounds;
    } catch (error) {
      logger.error('Check if password needs rehash failed:', error);
      return false;
    }
  }

  // Rehash password with new salt rounds
  async rehash(password, currentHash) {
    try {
      if (await this.needsRehash(currentHash)) {
        return await this.hash(password);
      }
      return currentHash;
    } catch (error) {
      logger.error('Password rehash failed:', error);
      throw error;
    }
  }

  // Get password hash information
  getHashInfo(hashedPassword) {
    try {
      if (!hashedPassword || typeof hashedPassword !== 'string') {
        throw new Error('Invalid hashed password');
      }

      const rounds = bcrypt.getRounds(hashedPassword);
      
      return {
        algorithm: 'bcrypt',
        rounds: rounds,
        needsUpgrade: rounds < this.saltRounds,
        currentSaltRounds: this.saltRounds
      };
    } catch (error) {
      logger.error('Get hash info failed:', error);
      throw error;
    }
  }
}

module.exports = new PasswordHash();
