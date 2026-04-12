#!/usr/bin/env node

/**
 * Gateway Daemon - Background Process Entry Point
 * @module core/gateway-daemon
 */

const fs = require('fs');
const path = require('path');

// Parse arguments
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex !== -1 ? parseInt(args[portIndex + 1]) : 19876;
const pidFileIndex = args.indexOf('--pid-file');
const pidFile = pidFileIndex !== -1 ? args[pidFileIndex + 1] : null;

// Write PID file immediately
if (pidFile) {
  fs.writeFileSync(pidFile, process.pid.toString());
}

// Cleanup on exit
const cleanup = () => {
  if (pidFile && fs.existsSync(pidFile)) {
    try {
      fs.unlinkSync(pidFile);
    } catch (e) {
      // Ignore
    }
  }
  process.exit(0);
};

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// Redirect console to files in production
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Start gateway
const { startGateway } = require('./gateway');

startGateway({ port })
  .then(() => {
    console.log(`Gateway daemon started on port ${port}`);
  })
  .catch((error) => {
    console.error('Failed to start gateway:', error);
    cleanup();
    process.exit(1);
  });
