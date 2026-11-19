const express = require('express');
const bot = require('../../bot');
const logger = require('../../logger');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    res.json(await bot.call('getInventorySets', {refresh: req.query.refresh === '1'}));
  } catch (err) {
    logger.warn(`Web UI: could not load inventory: ${err.message}`);
    res.status(502).json({error: err.message});
  }
});

router.get('/set-size/:appId', async (req, res) => {
  if (!/^\d{1,10}$/.test(req.params.appId)) {
    return res.status(400).json({error: 'Invalid app ID'});
  }
  try {
    res.json({appId: req.params.appId, size: await bot.call('loadSetSize', req.params.appId)});
  } catch (err) {
    logger.warn(`Web UI: could not load set size of ${req.params.appId}: ${err.message}`);
    res.status(502).json({error: err.message});
  }
});

module.exports = router;
