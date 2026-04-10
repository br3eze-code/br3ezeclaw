/**
 * Centralized Error Classes for AgentOS
 */

class AgentOSError extends Error {
  constructor(message, code, context = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

// Core Errors
class ConfigurationError extends AgentOSError {
  constructor(message, context = {}) {
    super(message, 'CONFIG_ERROR', context);
  }
}

class ValidationError extends AgentOSError {
  constructor(message, field = null, context = {}) {
    super(message, 'VALIDATION_ERROR', { ...context, field });
    this.field = field;
  }
}

class DatabaseError extends AgentOSError {
  constructor(message, operation = null, context = {}) {
    super(message, 'DB_ERROR', { ...context, operation });
    this.operation = operation;
  }
}

class NetworkError extends AgentOSError {
  constructor(message, endpoint = null, context = {}) {
    super(message, 'NETWORK_ERROR', { ...context, endpoint });
    this.endpoint = endpoint;
  }
}

class AuthenticationError extends AgentOSError {
  constructor(message, context = {}) {
    super(message, 'AUTH_ERROR', context);
  }
}

class PermissionError extends AgentOSError {
  constructor(message, required = null, current = null) {
    super(message, 'PERMISSION_ERROR', { required, current });
    this.required = required;
    this.current = current;
  }
}

module.exports = {
  AgentOSError,
  ConfigurationError,
  ValidationError,
  DatabaseError,
  NetworkError,
  AuthenticationError,
  PermissionError
};
