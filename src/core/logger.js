/**
 * Structured Logger with Winston
 * @module core/logger
 */
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');

// Create async local storage for correlation IDs
const asyncLocalStorage = new AsyncLocalStorage();

const correlationIdMiddleware = (req, res, next) => {
  const id = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = id;
  res.setHeader('x-correlation-id', id);

  // Run request in async context with correlation ID
  asyncLocalStorage.run(new Map(), () => {
    asyncLocalStorage.getStore().set('correlationId', id);
    next();
  });
};
// Ensure log directory exists
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const { combine, timestamp, json, errors, printf, colorize } = winston.format;

// Console format for development
const consoleFormat = printf(({ level, message, timestamp, service, ...metadata }) => {
  const meta = Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : '';
  return `${timestamp} [${service || 'agentos'}] ${level}: ${message} ${meta}`;
});
const auditLog = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/audit.log' }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'agentos' },
  
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
   winston.format((info) => {
      const store = asyncLocalStorage.getStore();
      if (store) {
        info.correlationId = store.get('correlationId');
      }
      return info;
    })(),
    errors({ stack: true })
  ),
  
  transports: [
    // Error log
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: json()
    }),
    
    // Combined log
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: json()
    }),
      // Audit log
    new winston.transports.File({
      filename: path.join(logDir, 'audit.log'),
      level: 'info',
      format: json()
    }),
    
    // Console output (development)
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'HH:mm:ss' }),
        consoleFormat
      )
    })
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(logDir, 'exceptions.log') })
  ],
  
  // Handle unhandled promise rejections
  
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(logDir, 'rejections.log') })
  ]
});

// Audit logger for security events

const auditLogger = winston.createLogger({
  level: 'info',
  format: combine(
    timestamp(),
    json()
  ),
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'audit.log') }),
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Create child logger with context
logger.child = (meta) => {
  return logger.child(meta);
};

// Helper to log audit events
logger.audit = (event, details) => {
  auditLogger.info(event, { ...details, type: 'audit' });
};

module.exports = { 
  logger, 
  correlationIdMiddleware,
  asyncLocalStorage 
};
