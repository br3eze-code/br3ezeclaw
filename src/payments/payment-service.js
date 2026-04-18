// src/payments/payment-service.js
// High-level payment service for AgentOS business logic

class PaymentService {
  constructor(paymentGateway) {
    this.gateway = paymentGateway;
    this.db = null; // Set via setDatabase()
  }

  setDatabase(database) {
    this.db = database;
  }

  /**
   * Create a voucher purchase transaction
   * @param {Object} params - Purchase parameters
   * @returns {Promise<Object>} Purchase result
   */
  async purchaseVoucher(params) {
    const {
      userId,
      voucherType,
      amount,
      currency,
      paymentMethod,
      customerPhone,
      customerEmail,
      metadata = {}
    } = params;

    // Generate unique reference
    const reference = `VOUCHER-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create payment
    const paymentResult = await this.gateway.createPayment(paymentMethod, {
      amount,
      currency,
      description: `WiFi Voucher: ${voucherType}`,
      reference,
      phoneNumber: customerPhone,
      email: customerEmail,
      metadata: {
        userId,
        voucherType,
        ...metadata
      }
    });

    // Store transaction in database
    if (this.db) {
      await this.db.collection('transactions').doc(paymentResult.transactionId).set({
        userId,
        voucherType,
        amount,
        currency,
        paymentMethod,
        status: paymentResult.status,
        reference,
        transactionId: paymentResult.transactionId,
        createdAt: new Date(),
        metadata: paymentResult
      });
    }

    return {
      ...paymentResult,
      reference
    };
  }

  /**
   * Handle successful payment and generate voucher
   * @param {string} transactionId - Payment transaction ID
   * @param {string} provider - Payment provider
   * @returns {Promise<Object>} Voucher details
   */
  async processSuccessfulPayment(transactionId, provider) {
    // Get transaction details
    const transaction = await this.gateway.verifyPayment(provider, transactionId);
    
    if (!transaction.success) {
      throw new Error('Payment not completed');
    }

    // Update transaction status
    if (this.db) {
      await this.db.collection('transactions').doc(transactionId).update({
        status: 'completed',
        completedAt: new Date(),
        paymentDetails: transaction
      });
    }

    // Generate voucher code
    const voucherCode = this.generateVoucherCode();
    const voucher = {
      code: voucherCode,
      type: transaction.metadata?.voucherType || '1Day',
      amount: transaction.amount,
      currency: transaction.currency,
      transactionId,
      createdAt: new Date(),
      expiresAt: this.calculateExpiry(transaction.metadata?.voucherType),
      used: false
    };

    // Store voucher
    if (this.db) {
      await this.db.collection('vouchers').doc(voucherCode).set(voucher);
      
      // Update user wallet
      if (transaction.metadata?.userId) {
        await this.db.collection('users').doc(transaction.metadata.userId)
          .collection('vouchers').add(voucher);
      }
    }

    return {
      success: true,
      voucher,
      transaction
    };
  }

  /**
   * Get payment methods available for a user
   * @param {Object} context - User context
   * @returns {Array} Available methods
   */
  async getAvailablePaymentMethods(context) {
    return this.gateway.getAvailableMethods(context);
  }

  /**
   * Process refund for a transaction
   * @param {string} transactionId - Transaction to refund
   * @param {string} provider - Payment provider
   * @param {number} amount - Amount to refund
   * @param {string} reason - Refund reason
   * @returns {Promise<Object>} Refund result
   */
  async processRefund(transactionId, provider, amount, reason) {
    const result = await this.gateway.refund(provider, transactionId, amount, reason);

    if (this.db) {
      await this.db.collection('transactions').doc(transactionId).update({
        refunded: true,
        refundAmount: amount,
        refundReason: reason,
        refundId: result.refundId,
        refundedAt: new Date()
      });
    }

    return result;
  }

  /**
   * Get transaction history for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Transaction history
   */
  async getTransactionHistory(userId, options = {}) {
    if (!this.db) return [];

    const { limit = 50, offset = 0 } = options;
    
    const snapshot = await this.db.collection('transactions')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset(offset)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }

  /**
   * Generate random voucher code
   * @returns {string} Voucher code
   */
  generateVoucherCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Add hyphens for readability: XXXX-XXXX
    return `${code.substr(0, 4)}-${code.substr(4, 4)}`;
  }

  /**
   * Calculate voucher expiry date
   * @param {string} type - Voucher type
   * @returns {Date} Expiry date
   */
  calculateExpiry(type) {
    const now = new Date();
    const multipliers = {
      '1Hour': 1,
      '1Day': 24,
      '1Week': 24 * 7,
      '1Month': 24 * 30
    };
    
    const hours = multipliers[type] || 24;
    return new Date(now.getTime() + hours * 60 * 60 * 1000);
  }
}

module.exports = PaymentService;
