// www/js/payments/pesapal-cordova.js
// PesaPal integration for Br3eze Cordova App

class PesaPalCordova {
  constructor(config) {
    this.config = {
      apiBaseUrl: config.apiBaseUrl || 'https://api.br3eze.africa',
      ...config
    };
  }

  /**
   * Purchase voucher from Cordova app
   */
  async purchaseVoucher(voucherType, amount, customerInfo) {
    try {
      // Step 1: Create payment via your backend
      const response = await fetch(`${this.config.apiBaseUrl}/payments/pesapal/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voucherType,
          amount,
          customerName: customerInfo.name,
          customerEmail: customerInfo.email,
          customerPhone: customerInfo.phone,
          deviceId: device.uuid || 'unknown'
        })
      });

      const payment = await response.json();

      if (!payment.success) {
        throw new Error(payment.error || 'Failed to create payment');
      }

      // Step 2: Open PesaPal in InAppBrowser
      return this.openPaymentWindow(payment);

    } catch (error) {
      console.error('PesaPal purchase error:', error);
      throw error;
    }
  }

  /**
   * Open PesaPal payment in InAppBrowser
   */
  openPaymentWindow(paymentData) {
    return new Promise((resolve, reject) => {
      const ref = cordova.InAppBrowser.open(
        paymentData.redirectUrl,
        '_blank',
        'location=yes,hidden=no,clearcache=yes,clearsessioncache=yes'
      );

      let paymentCompleted = false;

      // Listen for load events
      ref.addEventListener('loadstart', (event) => {
        console.log('Loading:', event.url);
        
        // Check for callback URL
        if (event.url.includes('payment/callback') || 
            event.url.includes('payment/success')) {
          paymentCompleted = true;
          ref.close();
          
          // Poll for status
          this.pollPaymentStatus(paymentData.orderTrackingId)
            .then(resolve)
            .catch(reject);
        }
      });

      ref.addEventListener('loaderror', (error) => {
        console.error('InAppBrowser error:', error);
        reject(new Error('Payment window failed to load'));
      });

      ref.addEventListener('exit', () => {
        if (!paymentCompleted) {
          // User closed without completing
          resolve({
            status: 'cancelled',
            orderTrackingId: paymentData.orderTrackingId
          });
        }
      });
    });
  }

  /**
   * Poll for payment status (fallback when IPN not available)
   */
  async pollPaymentStatus(orderTrackingId, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
      await this.delay(5000); // Wait 5 seconds
      
      try {
        const response = await fetch(
          `${this.config.apiBaseUrl}/payments/pesapal/status/${orderTrackingId}`
        );
        const status = await response.json();

        if (status.success) {
          return {
            status: 'completed',
            orderTrackingId,
            voucherCode: status.voucherCode,
            message: 'Payment successful! Voucher delivered.'
          };
        }

        if (status.status === 'failed') {
          throw new Error('Payment failed');
        }
        
      } catch (error) {
        console.error('Poll error:', error);
      }
    }

    return {
      status: 'pending',
      orderTrackingId,
      message: 'Payment pending. Check status later.'
    };
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for Cordova
window.PesaPalCordova = PesaPalCordova;
