// src/utils/logger.js
// ──────────────────────────────────────────────────────────────────────────────
// Bridge shim — several core modules import '../utils/logger' but the real
// implementation lives in src/core/logger.js. This file re-exports everything
// so both import paths resolve cleanly without touching each caller.
// ──────────────────────────────────────────────────────────────────────────────

'use strict';

const coreLogger = require('../core/logger');

// Named re-exports used in the wild: { Logger }, { logger }, default
module.exports = {
  ...coreLogger,
  // Alias: some files do `const { Logger } = require('../utils/logger')`
  Logger: coreLogger.logger
};
