const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

// Tell winston that you want to link the colors
winston.addColors(colors);

// Define which level to log based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

// Define format for logs
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}` +
    (info.stack ? `\n${info.stack}` : '') +
    (info.metadata && Object.keys(info.metadata).length > 0 ? 
      `\n${JSON.stringify(info.metadata, null, 2)}` : '')
  )
);

// Define which transports the logger must use
const transports = [
  // Console transport
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  })
];

// Add file transports only if not on Vercel and (production or LOG_TO_FILE is enabled)
if (!process.env.VERCEL && (process.env.NODE_ENV === 'production' || process.env.LOG_TO_FILE === 'true')) {
  // Create logs directory if it doesn't exist
  const fs = require('fs');
  const logsDir = path.join(__dirname, '../../logs');
  
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // File transport for all logs
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  );

  // File transport for warnings and above
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
  exitOnError: false
});

// Create a stream object for Morgan HTTP logger
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

// Add custom methods for structured logging
logger.logRequest = (req, res, responseTime) => {
  const logData = {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    statusCode: res.statusCode,
    responseTime: `${responseTime}ms`,
    contentLength: res.get('Content-Length') || 0
  };

  if (req.user) {
    logData.customerId = req.user.customer_id;
    logData.email = req.user.email;
  }

  if (res.statusCode >= 400) {
    logger.warn('HTTP Request', logData);
  } else {
    logger.http('HTTP Request', logData);
  }
};

logger.logError = (error, req = null) => {
  const logData = {
    message: error.message,
    stack: error.stack,
    name: error.name,
    code: error.code
  };

  if (req) {
    logData.request = {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    };

    if (req.user) {
      logData.request.customerId = req.user.customer_id;
      logData.request.email = req.user.email;
    }
  }

  logger.error('Application Error', logData);
};

logger.logAuth = (action, customerId, email, metadata = {}) => {
  const logData = {
    action,
    customerId,
    email,
    timestamp: new Date().toISOString(),
    ...metadata
  };

  logger.info('Authentication Event', logData);
};

logger.logTransaction = (action, transactionId, fromCustomerId, toCustomerId, amount, metadata = {}) => {
  const logData = {
    action,
    transactionId,
    fromCustomerId,
    toCustomerId,
    amount: parseFloat(amount),
    timestamp: new Date().toISOString(),
    ...metadata
  };

  logger.info('Transaction Event', logData);
};

logger.logDatabase = (operation, table, duration, metadata = {}) => {
  const logData = {
    operation,
    table,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString(),
    ...metadata
  };

  if (duration > 1000) {
    logger.warn('Slow Database Query', logData);
  } else {
    logger.debug('Database Operation', logData);
  }
};

logger.logSecurity = (event, severity = 'info', metadata = {}) => {
  const logData = {
    securityEvent: event,
    severity,
    timestamp: new Date().toISOString(),
    ...metadata
  };

  if (severity === 'critical' || severity === 'high') {
    logger.error('Security Event', logData);
  } else if (severity === 'medium') {
    logger.warn('Security Event', logData);
  } else {
    logger.info('Security Event', logData);
  }
};

// Performance monitoring
logger.logPerformance = (operation, duration, metadata = {}) => {
  const logData = {
    operation,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString(),
    ...metadata
  };

  if (duration > 5000) {
    logger.warn('Slow Operation', logData);
  } else if (duration > 1000) {
    logger.info('Performance Warning', logData);
  } else {
    logger.debug('Performance Metric', logData);
  }
};

// Business event logging
logger.logBusinessEvent = (eventType, customerId, metadata = {}) => {
  const logData = {
    eventType,
    customerId,
    timestamp: new Date().toISOString(),
    ...metadata
  };

  logger.info('Business Event', logData);
};

// Audit logging
logger.logAudit = (action, userId, resource, details = {}) => {
  const logData = {
    action,
    userId,
    resource,
    timestamp: new Date().toISOString(),
    details
  };

  logger.info('Audit Log', logData);
};

// System health logging
logger.logHealth = (component, status, metrics = {}) => {
  const logData = {
    component,
    status,
    timestamp: new Date().toISOString(),
    metrics
  };

  if (status === 'healthy') {
    logger.info('Health Check', logData);
  } else if (status === 'degraded') {
    logger.warn('Health Check', logData);
  } else {
    logger.error('Health Check', logData);
  }
};

// Development helpers
if (process.env.NODE_ENV === 'development') {
  logger.debug('Logger initialized in development mode');
  
  // Add pretty print for objects in development
  logger.pretty = (level, message, obj) => {
    logger.log(level, message, { 
      pretty: JSON.stringify(obj, null, 2) 
    });
  };
}

// Production optimizations
if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  // Handle uncaught exceptions
  logger.exceptions.handle(
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/exceptions.log')
    })
  );

  // Handle unhandled promise rejections
  logger.rejections.handle(
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/rejections.log')
    })
  );

  logger.info('Logger initialized in production mode');
} else if (process.env.NODE_ENV === 'production' && process.env.VERCEL) {
  logger.info('Logger initialized in Vercel production mode (Console only)');
}

// Export the logger
module.exports = logger;
