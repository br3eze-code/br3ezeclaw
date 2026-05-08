/**
 * Input Validation Utilities
 */

const { ValidationError } = require('../core/errors');

const validators = {
  // IP Address validation
  ip: (value) => {
    const regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!regex.test(value)) return false;
    const parts = value.split('.').map(Number);
    return parts.every(p => p >= 0 && p <= 255);
  },

  // MAC Address validation
  mac: (value) => {
    return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(value);
  },

  // Hostname validation
  hostname: (value) => {
    return /^[\w.-]+$/.test(value) && value.length <= 253;
  },

  // Username validation
  username: (value) => {
    return /^[a-zA-Z0-9_-]+$/.test(value) && value.length >= 2 && value.length <= 32;
  },

  // Voucher code validation
  voucherCode: (value) => {
    return /^STAR-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value);
  },

  // Plan validation
  plan: (value) => {
    return ['1hour', '1Day', '7Day', '30Day'].includes(value);
  }
};

function validate(type, value, fieldName = 'value') {
  const validator = validators[type];
  if (!validator) {
    throw new ValidationError(`Unknown validator type: ${type}`, fieldName);
  }
  
  if (!validator(value)) {
    throw new ValidationError(`Invalid ${type} format`, fieldName, { value });
  }
  
  return true;
}

function validateAll(schema, data) {
  const errors = [];
  
  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    
    // Required check
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push({ field, message: `${field} is required` });
      continue;
    }
    
    // Skip optional empty fields
    if (!value && !rules.required) continue;
    
    // Type validation
    if (rules.type && !validators[rules.type](value)) {
      errors.push({ field, message: `Invalid ${rules.type} format` });
    }
    
    // Custom validation
    if (rules.validate && !rules.validate(value)) {
      errors.push({ field, message: rules.message || `Invalid ${field}` });
    }
    
    // Length validation
    if (rules.minLength && value.length < rules.minLength) {
      errors.push({ field, message: `${field} must be at least ${rules.minLength} characters` });
    }
    if (rules.maxLength && value.length > rules.maxLength) {
      errors.push({ field, message: `${field} must be at most ${rules.maxLength} characters` });
    }
  }
  
  if (errors.length > 0) {
    const error = new ValidationError('Validation failed', null, { errors });
    error.errors = errors;
    throw error;
  }
  
  return true;
}

module.exports = {
  validators,
  validate,
  validateAll
};
