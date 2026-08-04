const express = require('express');
const {loadImage} = require('../../utils');

const router = express.Router();

// Liefert das (bei Bedarf gecachte) Steam-Kartenbild zur übergebenen Image-ID aus.
router.get('/:id', async (req, res) => {
  try {
    const filePath = await loadImage(req.params.id);
    // Bilder sind pro ID unveränderlich -> aggressiv cachen lassen.
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('png');
    res.sendFile(filePath);
  } catch (err) {
    res.status(502).send('Bild konnte nicht geladen werden');
  }
});

module.exports = router;
