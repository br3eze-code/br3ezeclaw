const winston = require('winston');
const path = require('path');
const fs = require('fs');

const { STATE_PATH } = global.AGENTOS || { STATE_PATH: './logs' };

// Ensure logs directory
const logDir = path.join(STATE_PATH, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error'
        }),
        new winston.transports.File({
            filename: path.join(logDir, 'combined.log')
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ level, message, timestamp }) => {
                    const emoji = global.AGENTOS?.BRAND?.emoji || '🤖';
                    return `${emoji} [${timestamp}] ${level}: ${message}`;
                })
            )
        })
    ]
});

module.exports = { logger };