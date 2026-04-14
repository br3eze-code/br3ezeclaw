'use strict';

const ErrorCodes = {
  // Connection errors (1000-1099)
  CONNECTION_REFUSED: 1001,
  CONNECTION_TIMEOUT: 1002,
  AUTH_FAILED:        1003,

  // Tool errors (2000-2099)
  TOOL_NOT_FOUND:        2001,
  TOOL_INVALID_PARAMS:   2002,
  TOOL_EXECUTION_FAILED: 2003,

  // Validation errors (3000-3099)
  VALIDATION_ERROR: 3001,
  RATE_LIMITED:     3002,

  // System errors (9000-9099)
  INTERNAL_ERROR:   9001,
  NOT_IMPLEMENTED:  9002
};

class AgentOSError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name      = 'AgentOSError';
    this.code      = code;
    this.details   = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      error:     true,
      code:      this.code,
      message:   this.message,
      details:   this.details,
      timestamp: this.timestamp
    };
  }
}

module.exports = { ErrorCodes, AgentOSError };


