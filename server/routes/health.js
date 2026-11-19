const { Router } = require('express');
const { healthCheck } = require('../db/queries');

const router = Router();

router.get('/health/live', (req, res) => res.json({ status: 'alive' }));

router.get('/health', async (req, res) => {
  try {
    const result = await healthCheck();
    res.json({ status: 'healthy', ...result.recordset[0] });
  } catch (err) {
    console.error('Azure SQL health failed:', err.code || err.name);
    res.status(503).json({ status: 'unhealthy', error: 'Azure SQL is unavailable or resuming; check identity, grants, TLS, and network access' });
  }
});

module.exports = router;
