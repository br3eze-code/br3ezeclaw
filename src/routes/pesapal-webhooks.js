// src/routes/pesapal-webhooks.js
// Express routes for PesaPal IPN handling

const express = require('express');
const router = express.Router();

/**
 * Setup PesaPal webhook routes
 * @param {PesaPalIntegration} pesapalIntegration - PesaPal integration instance
 */
function setupPesaPalRoutes(pesapalIntegration) {
  
  // IPN Endpoint - PesaPal sends POST notifications here
  router.post('/ipn', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
    console.log('[PesaPal IPN] Received:', req.body);
    
    try {
      // Verify the webhook
      const isValid = await pesapalIntegration.provider.verifyWebhook(req.body, req.headers);
      
      if (!isValid) {
        console.error('[PesaPal IPN] Invalid verification');
        return res.status(400).send('Invalid');
      }

      // Process the IPN data
      const ipnData = await pesapalIntegration.provider.processWebhook(req.body);
      console.log('[PesaPal IPN] Processed:', ipnData);

      // Handle based on status
      if (ipnData.status === 'completed') {
        await pesapalIntegration.handleSuccessfulPayment(ipnData);
      } else if (ipnData.status === 'failed') {
        // Handle failed payment
        console.log('[PesaPal IPN] Payment failed:', ipnData);
      }

      // IMPORTANT: Must respond with "OK" for PesaPal to stop retrying
      res.status(200).send('OK');
      
    } catch (error) {
      console.error('[PesaPal IPN] Error:', error);
      // Still return 200 to prevent PesaPal from retrying
      res.status(200).send('OK');
    }
  });

  // Manual status check endpoint
  router.get('/status/:orderTrackingId', async (req, res) => {
    try {
      const { orderTrackingId } = req.params;
      const status = await pesapalIntegration.getTransactionStatus(orderTrackingId);
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Initialize/setup endpoint
  router.post('/setup', async (req, res) => {
    try {
      const { ipnUrl } = req.body;
      const result = await pesapalIntegration.initialize(ipnUrl);
      res.json({ success: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = setupPesaPalRoutes;
