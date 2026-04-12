/**
 * API Routes v2
 * @module api/routes/v2
 */

const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', version: 'v2', features: ['websocket', 'ai'] });
});

module.exports = router;
