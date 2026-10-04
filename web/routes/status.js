const express = require('express');
const state = require('../../state');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(state.get());
});

module.exports = router;
