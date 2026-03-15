const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const expressValidator = require('express-validator');

// Import middleware
const {
  errorHandler,
  notFoundHandler,
  databaseErrorHandler,
  healthCheckErrorHandler,
  timeoutHandler,
  payloadTooLargeHandler
} = require('./middleware/errorHandler');
const {
  authenticate,
  securityHeaders,
  requestLogger,
  rateLimit: customRateLimit
} = require('./middleware/authMiddleware');

// Import routes
const authRoutes = require('./routes/authRoutes');
const bankRoutes = require('./routes/bankRoutes');
const userRoutes = require('./routes/userRoutes');
const chatbotRoutes = require('./routes/chatbotRoutes');

// Import utilities
const logger = require('./utils/logger');
const database = require('./config/database');

// Create Express app
const app = express();

// Global Debug Logger
app.use((req, res, next) => {
  console.log(`[DEBUG] Request: ${req.method} ${req.url}`);
  next();
});

// Trust proxy for rate limiting and IP detection
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
const corsOptions = {
  origin: true, // This automatically allows whatever URL is calling it (Perfect for split frontend/backend)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count']
};

app.use(cors(corsOptions));

// Custom security headers
app.use(securityHeaders);

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({
  extended: true,
  limit: '10mb'
}));

// Added raw body support for direct binary uploads (needed for image analysis)
app.use(express.raw({
  type: ['application/octet-stream', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  limit: '10mb'
}));

// Hugging Face API Proxy Endpoint (TOP PRIORITY)
app.use('/api/hf-proxy', async (req, res) => {
  try {
    const rawHfToken = process.env.HF_TOKEN || 'your_huggingface_token_here';
    const hfToken = rawHfToken.trim();

    let pathPart = req.url;
    if (pathPart.startsWith('/')) pathPart = pathPart.substring(1);

    // Use the new hf-inference path for raw models, router /v1 for chat
    let targetUrl = `https://router.huggingface.co/hf-inference/${pathPart}`;

    if (pathPart.includes('v1/chat/completions')) {
      targetUrl = `https://router.huggingface.co/v1/chat/completions`;
    }

    console.log(`[HF Proxy New Endpoint] ${req.method} ${req.originalUrl} -> ${targetUrl}`);

    const isBinary = req.headers['content-type'] === 'application/octet-stream' ||
      req.headers['content-type']?.includes('image/');

    const requestBody = (isBinary || req.method === 'GET' || req.method === 'DELETE' || req.method === 'OPTIONS') ?
      (isBinary ? req.body : undefined) :
      JSON.stringify(req.body);

    const fetchOptions = {
      method: req.method,
      headers: {
        'Authorization': `Bearer ${hfToken}`,
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Accept': 'application/json',
        'X-Wait-For-Model': 'true'
      }
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && requestBody) {
      fetchOptions.body = requestBody;
    }

    const response = await fetch(targetUrl, fetchOptions);
    console.log(`[HF Proxy-Top] Response Status: ${response.status}`);

    const contentType = response.headers.get('content-type');
    let data;

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { message: text };
      }
    }

    res.status(response.status).json(data);
  } catch (error) {
    console.error('[HF Proxy-Top Error]:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      error: 'PROXY_ERROR'
    });
  }
});

// Request logging
app.use(morgan('combined', { stream: logger.stream }));

// Custom request logger
app.use(requestLogger);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // Limit each IP
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    error: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.logSecurity('RATE_LIMIT_EXCEEDED', 'high', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      method: req.method,
      url: req.originalUrl
    });

    res.status(429).json({
      success: false,
      message: 'Too many requests from this IP, please try again later.',
      error: 'RATE_LIMIT_EXCEEDED',
      retryAfter: Math.ceil(15 * 60) // 15 minutes
    });
  }
});

app.use('/api/', limiter);

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, // Increased from 5 to 100 for stability during testing
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.',
    error: 'AUTH_RATE_LIMIT_EXCEEDED'
  },
  skipSuccessfulRequests: true
});

// Health check endpoint (no rate limiting)
app.get('/health', async (req, res) => {
  try {
    const dbHealth = await database.healthCheck();

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      database: dbHealth,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024 * 100) / 100
      }
    };

    if (dbHealth.status !== 'healthy') {
      health.status = 'degraded';
      return res.status(503).json(health);
    }

    res.json(health);
  } catch (error) {
    logger.logError(error, req);

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'KodBank API',
    version: '1.0.0',
    description: 'Modern Banking Application API',
    endpoints: {
      auth: '/api/auth',
      bank: '/api/bank',
      user: '/api/user',
      chatbot: '/api/chatbot',
      health: '/health'
    },
    documentation: '/api/docs',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

// API routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/user', userRoutes);
app.use('/api/chatbot', chatbotRoutes);

// API documentation (simple version)
app.get('/api/docs', (req, res) => {
  res.json({
    title: 'KodBank API Documentation',
    version: '1.0.0',
    description: 'Complete API documentation for KodBank banking application',
    baseUrl: `${req.protocol}://${req.get('host')}/api`,
    authentication: {
      type: 'Bearer Token',
      description: 'JWT token required for most endpoints',
      login: '/api/auth/login'
    },
    endpoints: {
      authentication: {
        'POST /auth/signup': 'Register new user',
        'POST /auth/login': 'User login',
        'POST /auth/logout': 'User logout',
        'GET /auth/profile': 'Get user profile',
        'PUT /auth/profile': 'Update user profile',
        'POST /auth/change-password': 'Change password',
        'DELETE /auth/account': 'Delete account'
      },
      banking: {
        'GET /bank/balance': 'Get account balance',
        'POST /bank/transfer': 'Transfer money',
        'GET /bank/transactions': 'Get transaction history',
        'POST /bank/deposit': 'Deposit money',
        'POST /bank/withdraw': 'Withdraw money',
        'GET /bank/statistics': 'Get account statistics'
      },
      user: {
        'GET /user/dashboard': 'Get dashboard data',
        'GET /user/activity': 'Get account activity',
        'GET /user/search': 'Search users',
        'GET /user/preferences': 'Get user preferences'
      }
    },
    errors: {
      commonCodes: {
        '400': 'Bad Request - Validation error',
        '401': 'Unauthorized - Authentication required',
        '403': 'Forbidden - Access denied',
        '404': 'Not Found - Resource not found',
        '429': 'Too Many Requests - Rate limit exceeded',
        '500': 'Internal Server Error'
      }
    },
    examples: {
      login: {
        method: 'POST',
        url: '/api/auth/login',
        body: {
          email: 'user@example.com',
          password: 'password123'
        }
      },
      transfer: {
        method: 'POST',
        url: '/api/bank/transfer',
        headers: {
          'Authorization': 'Bearer <jwt_token>'
        },
        body: {
          to_customer_id: 2,
          amount: 100.50,
          description: 'Payment for services'
        }
      }
    }
  });
});

// Handle 404 for API routes
app.use('/api/*', notFoundHandler);

// Error handling middleware
app.use(healthCheckErrorHandler);
app.use(databaseErrorHandler);
app.use(timeoutHandler);
app.use(payloadTooLargeHandler);
app.use(errorHandler);

// Handle 404 for non-API routes
app.use(notFoundHandler);


// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});


module.exports = app;
