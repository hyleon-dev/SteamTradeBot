const express = require('express');
const {loadImage} = require('../../utils');

const router = express.Router();

// Serves the Steam card image for the given image ID (cached on demand).
router.get('/:id', async (req, res) => {
  try {
    const filePath = await loadImage(req.params.id);
    // Images never change per ID -> allow aggressive caching.
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('png');
    res.sendFile(filePath);
  } catch (err) {
    res.status(502).send('Could not load image');
  }
});

module.exports = router;
