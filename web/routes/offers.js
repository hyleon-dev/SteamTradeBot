const express = require('express');
const bot = require('../../bot');
const logger = require('../../logger');

const router = express.Router();

// Steam trade offer IDs are numeric.
const isOfferId = (id) => /^\d{1,20}$/.test(id);

router.get('/open', async (req, res) => {
  try {
    res.json(await bot.call('getOpenOffers'));
  } catch (err) {
    logger.warn(`Web UI: could not load open offers: ${err.message}`);
    res.status(502).json({error: err.message});
  }
});

for (const [action, fn] of [['accept', 'manualAcceptOffer'], ['decline', 'manualDeclineOffer']]) {
  router.post(`/:id/${action}`, async (req, res) => {
    if (!isOfferId(req.params.id)) {
      return res.status(400).json({error: 'Invalid offer ID'});
    }
    try {
      await bot.call(fn, req.params.id);
      res.json({ok: true});
    } catch (err) {
      logger.warn(`Web UI: could not ${action} offer ${req.params.id}: ${err.message}`);
      res.status(409).json({error: err.message});
    }
  });
}

module.exports = router;
