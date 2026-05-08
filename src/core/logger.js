'use strict';

/**
 * Structured Logger with Winston
 * @module core/logger
 */
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const { A } = require('./constants');
const util = require('util');

// Create async local storage for correlation IDs
const asyncLocalStorage = new AsyncLocalStorage();

const correlationIdMiddleware = (req, res, next) => {
  const id = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = id;
  res.setHeader('x-correlation-id', id);

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

// Custom levels for AgentOS
const customLevels = {
  levels: {
    fatal: 0,
    error: 1,
    warn: 2,
    success: 3,
    info: 4,
    cyber: 5,
    debug: 6,
    trace: 7
  },
  colors: {
    fatal: 'red',
    error: 'red',
    warn: 'yellow',
    success: 'green',
    info: 'blue',
    cyber: 'cyan',
    debug: 'magenta',
    trace: 'gray'
  }
};

// Console format for development
const consoleFormat = printf(({ level, message, timestamp, service, stack, correlationId, ...metadata }) => {
  let meta = '';
  const metaKeys = Object.keys(metadata).filter(k => k !== 'service' && k !== 'timestamp');
  if (metaKeys.length > 0) {
    if (metadata.isBoom) {
      meta = `\n  ↳ ${A.WARN}[Boom] ${metadata.output?.payload?.error || 'Error'}: ${metadata.output?.payload?.message || message}${A.RESET}`;
    } else {
      // Cleaner meta display
      meta = '\n' + util.inspect(metadata, { colors: true, depth: 2, compact: true, breakLength: 80 })
        .split('\n').map(line => `    ${A.DIM}${line}${A.RESET}`).join('\n');
    }
  }
  
  let stackTrace = '';
  if (stack) {
    stackTrace = '\n' + stack.split('\n').slice(1).map(l => `    ${A.ERROR}${l.trim()}${A.RESET}`).join('\n');
  }

  const timeStr = `${A.DIM}${timestamp}${A.RESET}`;
  const svcStr = `${A.PRIMARY}${service || 'agentos'}${A.RESET}`;
  
  // High-fidelity level markers
  let levelStr = level;
  const cleanLevel = level.replace(/\u001b\[[0-9;]*m/g, ''); // Remove color codes for matching
  
  if (cleanLevel === 'info') levelStr = `${A.INFO}ℹ${A.RESET}`;
  else if (cleanLevel === 'success') levelStr = `${A.SUCCESS}✔${A.RESET}`;
  else if (cleanLevel === 'error') levelStr = `${A.ERROR}✘${A.RESET}`;
  else if (cleanLevel === 'fatal') levelStr = `${A.BOLD}${A.ERROR}✖${A.RESET}`;
  else if (cleanLevel === 'warn') levelStr = `${A.WARN}⚠${A.RESET}`;
  else if (cleanLevel === 'cyber') levelStr = `${A.NEON_CYAN}◆${A.RESET}`;
  else if (cleanLevel === 'debug') levelStr = `${A.CYBER_PURPLE}◇${A.RESET}`;
  else if (cleanLevel === 'trace') levelStr = `${A.DIM}◌${A.RESET}`;

  return `${timeStr} [${svcStr}] ${levelStr} ${message}${meta}${stackTrace}`;
});

// Create logger instance
const logger = winston.createLogger({
  levels: customLevels.levels,
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'agentos' },

  format: combine(
    timestamp({ format: 'HH:mm:ss' }),
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
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: json()
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: json()
    }),
    new winston.transports.Console({
      format: combine(
        colorize({ levels: customLevels.levels }),
        consoleFormat
      )
    }),
    // New UDP transport for logging daemon
    new (class extends winston.Transport {
      constructor(opts) {
        super(opts);
        this.port = opts.port || 5001;
        this.host = opts.host || '127.0.0.1';
        this.client = require('dgram').createSocket('udp4');
        this.client.unref();
      }
      log(info, callback) {
        setImmediate(() => this.emit('logged', info));
        const message = Buffer.from(JSON.stringify(info));
        this.client.send(message, 0, message.length, this.port, this.host, (err) => {
          if (err) console.error('UDP Log Error:', err);
        });
        if (callback) callback();
      }
    })({ level: 'debug' })
  ],

// exceptionHandlers and rejectionHandlers removed for debugging
});

// Audit logger
const auditLogger = winston.createLogger({
  level: 'info',
  format: combine(timestamp(), json()),
  transports: [new winston.transports.File({ filename: path.join(logDir, 'audit.log') })]
});

logger.audit = (event, details) => {
  auditLogger.info(event, { ...details, type: 'audit' });
};

// Bind methods for easy usage
logger.success = logger.success.bind(logger);
logger.cyber = logger.cyber.bind(logger);
logger.fatal = logger.fatal.bind(logger);
logger.trace = logger.trace.bind(logger);

module.exports = {
  logger,
  correlationIdMiddleware,
  asyncLocalStorage
};
