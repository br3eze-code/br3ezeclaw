// src/payments/providers/pesapay-provider.js
// PesaPay/PesaPal Payment Gateway Integration for AgentOS
// Supports: Mobile Money (EcoCash, OneMoney, Telecash), Cards, Bank Transfers

const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

class PesaPayProvider {
  constructor(config) {
    this.config = {
      consumerKey: config.pesapayConsumerKey || process.env.PESAPAY_CONSUMER_KEY,
      consumerSecret: config.pesapayConsumerSecret || process.env.PESAPAY_CONSUMER_SECRET,
      environment: config.pesapayEnvironment || process.env.PESAPAY_ENV || 'sandbox',
      callbackUrl: config.pesapayCallbackUrl || process.env.PESAPAY_CALLBACK_URL,
      ...config
    };

    // PesaPay API endpoints
    this.baseUrls = {
      sandbox: 'https://cybqa.pesapal.com/pesapalv3',
      production: 'https://pay.pesapal.com/v3'
    };

    this.baseUrl = this.baseUrls[this.config.environment] || this.baseUrls.sandbox;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Authenticate and get access token
   */
  async authenticate() {
    // Check if token is still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const auth = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`).toString('base64');

    const response = await this.makeRequest('/api/Auth/RequestToken', 'POST', null, {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    });

    this.accessToken = response.token;
    // Token expires in 5 minutes, refresh after 4
    this.tokenExpiry = Date.now() + (4 * 60 * 1000);

    return this.accessToken;
  }

  /**
   * Register IPN (Instant Payment Notification) URL
   * @param {string} url - Your webhook URL
   * @param {string} method - GET or POST
   */
  async registerIPN(url, method = 'POST') {
    const token = await this.authenticate();

    const payload = {
      url: url,
      ipn_notification_type: method
    };

    return await this.makeRequest('/api/URLSetup/RegisterIPN', 'POST', payload, {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });
  }

  /**
   * Get registered IPN URLs
   */
  async getRegisteredIPNs() {
    const token = await this.authenticate();

    return await this.makeRequest('/api/URLSetup/GetIpnList', 'GET', null, {
      'Authorization': `Bearer ${token}`
    });
  }

  /**
   * Submit payment order/request
   * @param {Object} data - Payment details
   */
  async createPayment(data) {
    const {
      amount,
      currency = 'ZWL',
      description,
      reference,
      customerEmail,
      customerPhone,
      customerName,
      callbackUrl,
      notificationId, // IPN ID from registerIPN
      billingAddress
    } = data;

    const token = await this.authenticate();

    const payload = {
      id: reference || `AGENTOS-${Date.now()}`,
      currency: currency,
      amount: parseFloat(amount),
      description: description || 'AgentOS WiFi Voucher',
      callback_url: callbackUrl || this.config.callbackUrl,
      notification_id: notificationId,
      billing_address: {
        email_address: customerEmail,
        phone_number: this.sanitizePhoneNumber(customerPhone),
        country_code: 'ZW',
        first_name: customerName?.split(' ')[0] || 'Customer',
        last_name: customerName?.split(' ').slice(1).join(' ') || 'User',
        ...billingAddress
      }
    };

    const response = await this.makeRequest('/api/Transactions/SubmitOrderRequest', 'POST', payload, {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });

    return {
      success: true,
      transactionId: response.order_tracking_id,
      merchantReference: response.merchant_reference,
      status: 'pending',
      amount: amount,
      currency: currency,
      provider: 'pesapay',
      redirectUrl: response.redirect_url,
      instructions: 'Complete payment using the provided link',
      // PesaPay supports multiple methods - user chooses on their page
      availableMethods: [
        'EcoCash',
        'OneMoney (NetOne)',
        'Telecash',
        'Visa/Mastercard',
        'Bank Transfer'
      ]
    };
  }

  /**
   * Get transaction status
   * @param {string} orderTrackingId - PesaPay order tracking ID
   */
  async verifyPayment(orderTrackingId) {
    const token = await this.authenticate();

    const response = await this.makeRequest(
      `/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
      'GET',
      null,
      {
        'Authorization': `Bearer ${token}`
      }
    );

    const statusMap = {
      'INVALID': 'failed',
      'FAILED': 'failed',
      'COMPLETED': 'completed',
      'REVERSED': 'refunded',
      'PENDING': 'pending'
    };

    return {
      success: response.status === 'COMPLETED',
      status: statusMap[response.status] || response.status.toLowerCase(),
      transactionId: response.order_tracking_id,
      paymentMethod: response.payment_method,
      amount: parseFloat(response.amount),
      currency: response.currency,
      createdAt: response.created_date,
      paidAt: response.payment_status_description === 'Completed' ? new Date() : null,
      confirmationCode: response.confirmation_code,
      paymentAccount: response.payment_account
    };
  }

  /**
   * Request refund
   * @param {string} transactionId - Original transaction ID
   * @param {number} amount - Amount to refund
   * @param {string} reason - Refund reason
   */
  async refund(transactionId, amount, reason) {
    const token = await this.authenticate();

    const payload = {
      order_tracking_id: transactionId,
      amount: amount.toFixed(2),
      reason: reason || 'Customer request'
    };

    const response = await this.makeRequest('/api/Transactions/RefundRequest', 'POST', payload, {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });

    return {
      success: response.status === 'SUCCESS',
      refundId: response.refund_id,
      status: response.status.toLowerCase(),
      amount: parseFloat(response.amount),
      message: response.message
    };
  }

  /**
   * Verify webhook/IPN signature
   * @param {Object} payload - Webhook payload
   * @param {Object} headers - Request headers
   */
  async verifyWebhook(payload, headers) {
    // PesaPay IPN sends data as query parameters or JSON
    // Verify using the OrderTrackingId and status
    const orderTrackingId = payload.OrderTrackingId || payload.order_tracking_id;
    
    if (!orderTrackingId) return false;

    // Verify by checking transaction status directly
    try {
      const status = await this.verifyPayment(orderTrackingId);
      return status.transactionId === orderTrackingId;
    } catch (error) {
      return false;
    }
  }

  /**
   * Process webhook payload
   * @param {Object} payload - Webhook data
   */
  async processWebhook(payload) {
    const {
      OrderTrackingId,
      OrderMerchantReference,
      OrderNotificationType,
      OrderCurrency,
      OrderAmount,
      Status
    } = payload;

    const statusMap = {
      'COMPLETED': 'payment_success',
      'FAILED': 'payment_failed',
      'REVERSED': 'payment_reversed',
      'PENDING': 'payment_pending'
    };

    return {
      type: statusMap[Status] || 'payment_update',
      transactionId: OrderTrackingId,
      merchantReference: OrderMerchantReference,
      notificationType: OrderNotificationType,
      amount: parseFloat(OrderAmount),
      currency: OrderCurrency,
      status: Status?.toLowerCase(),
      raw: payload
    };
  }

  /**
   * Get payment methods supported by PesaPay
   */
  getSupportedMethods() {
    return [
      {
        id: 'pesapay_ecocash',
        name: 'EcoCash',
        type: 'mobile_money',
        icon: '💳',
        description: 'Pay with EcoCash mobile wallet',
        provider: 'pesapay'
      },
      {
        id: 'pesapay_onemoney',
        name: 'OneMoney',
        type: 'mobile_money',
        icon: '📱',
        description: 'Pay with NetOne OneMoney',
        provider: 'pesapay'
      },
      {
        id: 'pesapay_telecash',
        name: 'Telecash',
        type: 'mobile_money',
        icon: '💰',
        description: 'Pay with Telecash',
        provider: 'pesapay'
      },
      {
        id: 'pesapay_card',
        name: 'Card Payment',
        type: 'card',
        icon: '💳',
        description: 'Visa, Mastercard, American Express',
        provider: 'pesapay'
      },
      {
        id: 'pesapay_bank',
        name: 'Bank Transfer',
        type: 'bank_transfer',
        icon: '🏦',
        description: 'Direct bank transfer',
        provider: 'pesapay'
      }
    ];
  }

  /**
   * Sanitize Zimbabwe phone number
   */
  sanitizePhoneNumber(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '263' + cleaned.substring(1);
    }
    if (!cleaned.startsWith('263')) {
      cleaned = '263' + cleaned;
    }
    return cleaned;
  }

  /**
   * Make HTTP request to PesaPay API
   */
  makeRequest(endpoint, method, body = null, customHeaders = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + endpoint);
      
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Accept': 'application/json',
          ...customHeaders
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(parsed.error?.message || parsed.message || 'PesaPay API error'));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error('Invalid JSON response from PesaPay'));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`Request failed: ${err.message}`)));
      
      if (body && method !== 'GET') {
        req.write(JSON.stringify(body));
      }
      
      req.end();
    });
  }
}

module.exports = PesaPayProvider;
