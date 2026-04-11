/**
 * Mastercard A2A (Account-to-Account) Payment Service
 * Integrates with Mastercard Send API and Cross-Border Services
 * For Br3eze Africa WiFi Voucher Payments
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class MastercardA2AService {
    constructor() {
        this.config = {
            baseURL: process.env.NODE_ENV === 'production'
                ? process.env.MASTERCARD_PRODUCTION_URL
                : process.env.MASTERCARD_SANDBOX_URL,
            partnerId: process.env.MASTERCARD_PARTNER_ID,
            apiKey: process.env.MASTERCARD_API_KEY,
            keystorePath: process.env.MASTERCARD_KEYSTORE_PATH,
            keystorePassword: process.env.MASTERCARD_KEYSTORE_PASSWORD,
            keyAlias: process.env.MASTERCARD_KEY_ALIAS,
            currency: process.env.MASTERCARD_PAYMENT_CURRENCY || 'USD',
            fundingSource: process.env.MASTERCARD_FUNDING_SOURCE,
        };

        this.basePath = '/send/v1/partners';
    }

    /**
     * Generate OAuth 1.0a signature for Mastercard API authentication
     */
    generateOAuthSignature(method, url, payload = '') {
        const timestamp = Math.floor(Date.now() / 1000);
        const nonce = uuidv4().replace(/-/g, '');

        const params = {
            oauth_consumer_key: this.config.apiKey,
            oauth_nonce: nonce,
            oauth_signature_method: 'RSA-SHA256',
            oauth_timestamp: timestamp,
            oauth_version: '1.0',
        };

        // Create parameter string
        const paramString = Object.keys(params)
            .sort()
            .map(k => `${k}=${encodeURIComponent(params[k])}`)
            .join('&');

        const baseString = [
            method.toUpperCase(),
            encodeURIComponent(url),
            encodeURIComponent(paramString),
        ].join('&');

        // Sign with private key
        const privateKey = this._getPrivateKey();
        const signature = crypto.createSign('RSA-SHA256')
            .update(baseString)
            .sign(privateKey, 'base64');

        params.oauth_signature = signature;

        // Build Authorization header
        const authHeader = 'OAuth ' + Object.keys(params)
            .map(k => `${k}="${encodeURIComponent(params[k])}"`)
            .join(', ');

        return authHeader;
    }

    _getPrivateKey() {
        try {
            const p12Buffer = fs.readFileSync(this.config.keystorePath);
            // In production, use proper PKCS#12 parsing
            // For now, assume PEM format for development
            return fs.readFileSync(
                this.config.keystorePath.replace('.p12', '.pem'),
                'utf8'
            );
        } catch (error) {
            throw new Error(`Failed to load private key: ${error.message}`);
        }
    }

    /**
     * Request a payment quote before initiating transfer
     * Required for Cross-Border Services API
     */
    async requestQuote(paymentDetails) {
        const {
            amount,
            currency = this.config.currency,
            recipientCountry,
            recipientCurrency,
            feesIncluded = true,
        } = paymentDetails;

        const url = `${this.config.baseURL}${this.basePath}/${this.config.partnerId}/quotes`;

        const payload = {
            payment_origination_country: 'ZWE', // Zimbabwe
            payment_type: 'P2B', // Person to Business
            payment_date: new Date().toISOString().split('T')[0],
            sender: {
                funding_source: this.config.fundingSource,
                currency: currency,
                amount: amount.toString(),
            },
            recipient: {
                receiving_country: recipientCountry || 'ZWE',
                currency: recipientCurrency || currency,
                fees_included: feesIncluded.toString(),
            },
        };

        const headers = {
            'Authorization': this.generateOAuthSignature('POST', url, JSON.stringify(payload)),
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        try {
            const response = await axios.post(url, payload, { headers });
            return {
                success: true,
                proposalId: response.data.proposal_id,
                exchangeRate: response.data.exchange_rate,
                fees: response.data.fees,
                totalAmount: response.data.payment_amount,
                confirmationExpiry: response.data.confirmation_expiry_time,
                raw: response.data,
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data || error.message,
            };
        }
    }

    /**
     * Confirm a quote before payment (required for some corridors)
     */
    async confirmQuote(proposalId, transactionRef) {
        const url = `${this.config.baseURL}${this.basePath}/${this.config.partnerId}/quote-confirmations`;

        const payload = {
            proposal_id: proposalId,
            transaction_reference: transactionRef,
        };

        const headers = {
            'Authorization': this.generateOAuthSignature('POST', url, JSON.stringify(payload)),
            'Content-Type': 'application/json',
        };

        try {
            const response = await axios.post(url, payload, { headers });
            return {
                success: true,
                confirmationId: response.data.confirmation_id,
                status: response.data.status,
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data || error.message,
            };
        }
    }

    /**
     * Initiate A2A payment using confirmed quote
     */
    async initiatePayment(paymentDetails) {
        const {
            proposalId, // If using quote-based payment
            amount,
            currency,
            recipientName,
            recipientAccount,
            recipientBankCode,
            recipientCountry = 'ZWE',
            transactionRef,
            voucherCode, // Br3eze specific
        } = paymentDetails;

        const url = `${this.config.baseURL}${this.basePath}/${this.config.partnerId}/payments`;

        const payload = {
            transaction_reference: transactionRef || `BR3EZE-${uuidv4().slice(0, 8)}`,
            payment_type: 'P2B',
            payment_date: new Date().toISOString().split('T')[0],
            sender: {
                funding_source: this.config.fundingSource,
                currency: currency || this.config.currency,
                amount: amount.toString(),
            },
            recipient: {
                receiving_country: recipientCountry,
                currency: currency || this.config.currency,
                name: recipientName,
                account_uri: `iban:${recipientAccount}`, // or other format
                bank_code: recipientBankCode,
            },
            proposal_id: proposalId, // Optional for one-shot payments
            purpose_of_payment: 'Payment for WiFi Voucher',
            metadata: {
                voucher_code: voucherCode,
                service: 'Br3eze Africa Hotspot',
            },
        };

        const headers = {
            'Authorization': this.generateOAuthSignature('POST', url, JSON.stringify(payload)),
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        try {
            const response = await axios.post(url, payload, { headers });
            return {
                success: true,
                paymentId: response.data.payment_id,
                status: response.data.status, // PENDING, COMPLETED, etc.
                transactionRef: payload.transaction_reference,
                amount: amount,
                currency: currency || this.config.currency,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data || error.message,
            };
        }
    }

    /**
     * Check payment status
     */
    async getPaymentStatus(paymentId) {
        const url = `${this.config.baseURL}${this.basePath}/${this.config.partnerId}/payments/${paymentId}`;

        const headers = {
            'Authorization': this.generateOAuthSignature('GET', url),
            'Accept': 'application/json',
        };

        try {
            const response = await axios.get(url, { headers });
            return {
                success: true,
                status: response.data.status,
                paymentId: response.data.payment_id,
                amount: response.data.payment_amount,
                currency: response.data.payment_currency,
                recipient: response.data.recipient,
                createdAt: response.data.created_at,
                completedAt: response.data.completed_at,
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data || error.message,
            };
        }
    }

    /**
     * Cancel a pending payment
     */
    async cancelPayment(paymentId) {
        const url = `${this.config.baseURL}${this.basePath}/${this.config.partnerId}/payments/${paymentId}/cancel`;

        const headers = {
            'Authorization': this.generateOAuthSignature('POST', url),
            'Content-Type': 'application/json',
        };

        try {
            const response = await axios.post(url, {}, { headers });
            return {
                success: true,
                status: response.data.status,
                cancellationTime: new Date().toISOString(),
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data || error.message,
            };
        }
    }

    /**
     * Validate account before payment (Account Validation API)
     */
    async validateAccount(accountNumber, accountType = 'IBAN') {
        const url = `${this.config.baseURL}/account-validation/v1/partners/${this.config.partnerId}/accounts/validate`;

        const payload = {
            account_type: accountType,
            account_value: accountNumber,
        };

        const headers = {
            'Authorization': this.generateOAuthSignature('POST', url, JSON.stringify(payload)),
            'Content-Type': 'application/json',
        };

        try {
            const response = await axios.post(url, payload, { headers });
            return {
                success: true,
                valid: response.data.valid,
                accountName: response.data.account_name,
                bankName: response.data.bank_name,
            };
        } catch (error) {
            return {
                success: false,
                valid: false,
                error: error.response?.data || error.message,
            };
        }
    }

    // ==================== BR3EZE-SPECIFIC METHODS ====================

    /**
     * Process voucher purchase with A2A payment
     * Integrates with your existing voucher system
     */
    async processVoucherPurchase(voucherDetails, paymentDetails) {
        const {
            plan, // '1hour', '1Day', '7Day', '30Day'
            email,
            code,
        } = voucherDetails;

        const {
            amount,
            recipientAccount, // Your business receiving account
            recipientBankCode,
        } = paymentDetails;

        // Step 1: Request quote for transparency
        const quote = await this.requestQuote({
            amount: amount,
            currency: 'USD',
            recipientCountry: 'ZWE',
            feesIncluded: true,
        });

        if (!quote.success) {
            return {
                success: false,
                stage: 'quote',
                error: quote.error,
            };
        }

        // Step 2: Generate unique transaction reference
        const transactionRef = `BR3EZE-${code}-${Date.now()}`;

        // Step 3: Initiate payment
        const payment = await this.initiatePayment({
            proposalId: quote.proposalId,
            amount: amount,
            currency: 'USD',
            recipientName: 'Br3eze Africa',
            recipientAccount: recipientAccount,
            recipientBankCode: recipientBankCode,
            transactionRef: transactionRef,
            voucherCode: code,
        });

        if (!payment.success) {
            return {
                success: false,
                stage: 'payment',
                error: payment.error,
                quote: quote,
            };
        }

        // Step 4: Return payment info for tracking
        return {
            success: true,
            paymentId: payment.paymentId,
            transactionRef: transactionRef,
            status: payment.status,
            amount: amount,
            exchangeRate: quote.exchangeRate,
            fees: quote.fees,
            voucherCode: code,
            plan: plan,
            timestamp: payment.timestamp,
        };
    }

    /**
     * Webhook handler for payment status updates
     */
    async handleWebhook(payload) {
        const { event_type, payment_id, status, transaction_reference } = payload;

        // Update your database
        // This would integrate with your existing database class
        const update = {
            paymentStatus: status,
            updatedAt: new Date().toISOString(),
        };

        if (status === 'COMPLETED') {
            // Activate voucher in MikroTik
            // This calls your existing mikrotik.addHotspotUser()
            update.activated = true;
            update.activatedAt = new Date().toISOString();
        }

        return {
            received: true,
            event: event_type,
            paymentId: payment_id,
            processed: true,
        };
    }
}

module.exports = MastercardA2AService;
