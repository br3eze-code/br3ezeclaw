const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');
const https = require('https');

// Configuration
const CONFIG = {
  dbPath: path.join(process.env.HOME || process.env.USERPROFILE, '.agentos/state/agentos.db'),
  backupDir: path.join(process.env.HOME || process.env.USERPROFILE, '.agentos/backups'),
  serverUrl: process.env.SERVER_URL || 'http://127.0.0.1:3000/health',
  alertEmail: process.env.ALERT_EMAIL || 'admin@example.com',
  logFile: path.join(process.env.HOME || process.env.USERPROFILE, '.agentos/logs/automate.log'),
  checkIntervalMs: 60 * 1000, // 1 minute
  backupIntervalMs: 24 * 60 * 60 * 1000, // 24 hours
};

// Ensure directories exist
function ensureDirs() {
  [CONFIG.backupDir, path.dirname(CONFIG.logFile)].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// Log errors
function log(msg, isError = false) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${isError ? 'ERROR' : 'INFO'}: ${msg}\n`;
  console.log(logLine.trim());
  fs.appendFileSync(CONFIG.logFile, logLine);
}

// Send Alert (Mock implementation, can be extended to use nodemailer, PagerDuty, or Telegram)
function sendAlert(subject, message) {
  log(`ALERT TRIGERRED: ${subject} - ${message}`, true);
  // Example for a telegram alert if token is available
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ALLOWED_CHAT_ID) {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const data = JSON.stringify({
      chat_id: process.env.TELEGRAM_ALLOWED_CHAT_ID.split(',')[0],
      text: `⚠️ *${subject}*\n${message}`
    });

    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    });
    req.on('error', (e) => log(`Failed to send Telegram alert: ${e.message}`, true));
    req.write(data);
    req.end();
  }
}

// Backup Database
function backupDatabase() {
  log('Starting database backup...');
  try {
    if (!fs.existsSync(CONFIG.dbPath)) {
      log(`Database not found at ${CONFIG.dbPath}`, true);
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(CONFIG.backupDir, `agentos_backup_${timestamp}.db`);
    fs.copyFileSync(CONFIG.dbPath, backupPath);
    log(`Database backed up successfully to ${backupPath}`);
    
    // Cleanup old backups (keep last 7 days)
    const files = fs.readdirSync(CONFIG.backupDir);
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(CONFIG.backupDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > 7 * 24 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
        log(`Deleted old backup: ${filePath}`);
      }
    });
  } catch (err) {
    log(`Database backup failed: ${err.message}`, true);
    sendAlert('Database Backup Failed', err.message);
  }
}

// Check Server Status
function checkServer() {
  const protocol = CONFIG.serverUrl.startsWith('https') ? https : http;
  protocol.get(CONFIG.serverUrl, (res) => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      log('Server is UP.');
    } else {
      const msg = `Server responded with status code: ${res.statusCode}`;
      log(msg, true);
      sendAlert('Server Down or Degraded', msg);
    }
  }).on('error', (err) => {
    log(`Server check failed: ${err.message}`, true);
    sendAlert('Server Unreachable', err.message);
  });
}

// Start Automation
function start() {
  ensureDirs();
  log('Automation started: Monitoring server, database, and logging errors invisibly.');
  
  // Initial checks
  checkServer();
  backupDatabase();

  // Schedule intervals
  setInterval(checkServer, CONFIG.checkIntervalMs);
  setInterval(backupDatabase, CONFIG.backupIntervalMs);
}

start();
