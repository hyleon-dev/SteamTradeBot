const express = require('express');
const {getTrades, getTradeAggregates, getMessages} = require('../../db');

const router = express.Router();

router.get('/trades', (req, res) => {
  const {from, to, accepted, limit} = req.query;
  res.json(getTrades({
    from: from != null ? Number(from) : undefined,
    to: to != null ? Number(to) : undefined,
    accepted: accepted === undefined ? undefined : (accepted === 'true'
        || accepted === '1'),
    limit: limit != null ? Number(limit) : undefined,
  }));
});

router.get('/trades/stats', (req, res) => {
  const groupBy = ['day', 'week', 'month'].includes(req.query.groupBy)
      ? req.query.groupBy : 'day';
  res.json(getTradeAggregates({groupBy}));
});

router.get('/messages', (req, res) => {
  const {limit} = req.query;
  res.json(getMessages({limit: limit != null ? Number(limit) : undefined}));
});

module.exports = router;
