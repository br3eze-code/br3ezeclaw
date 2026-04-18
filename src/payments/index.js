// src/payments/index.js
// Payment module entry point for AgentOS

const { PaymentGateway } = require('./payment-gateway');
const PaymentService = require('./payment-service');
const webhookHandler = require('./webhook-handler');

module.exports = {
  PaymentGateway,
  PaymentService,
  webhookHandler,
  
  // Factory function for easy initialization
  createPaymentService: (config) => {
    const gateway = new PaymentGateway(config);
    return new PaymentService(gateway);
  }
};
