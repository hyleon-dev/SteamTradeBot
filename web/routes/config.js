const express = require('express');
const config = require('../../config');
const logger = require('../../logger');

const router = express.Router();

const isIdList = (value) => {
  const arr = Array.isArray(value) ? value : String(value).split(',');
  return arr.map(s => String(s).trim()).filter(Boolean).every(
      s => /^\d+$/.test(s));
};

function validate(partial) {
  const errors = [];
  for (const [key, value] of Object.entries(partial)) {
    const field = config.FIELD_BY_KEY.get(key);
    if (!field) {
      errors.push(`Unknown field: ${key}`);
      continue;
    }
    if (field.type === 'ids' || field.type === 'idOrNull') {
      if (value && !isIdList(value)) {
        errors.push(
            `${key} must be a comma-separated list of numeric App/Steam IDs`);
      }
    }
    if (key === 'port' && value && !/^\d+$/.test(String(value))) {
      errors.push('port must be numeric');
    }
  }
  return errors;
}

// GET – aktuelle Config; Secrets werden maskiert (nur "gesetzt ja/nein").
router.get('/', (req, res) => {
  const fields = config.describe().map(f => {
    if (f.secret) {
      return {
        key: f.key,
        secret: true,
        restartRequired: f.restartRequired,
        isSet: !!f.value
      };
    }
    return {
      key: f.key,
      secret: false,
      restartRequired: f.restartRequired,
      value: f.value
    };
  });
  res.json({fields});
});

// POST – Config übernehmen. Leere Secret-Felder werden ignoriert (nicht überschrieben).
router.post('/', (req, res) => {
  const partial = {...req.body};

  // Leere Secret-Werte nicht übernehmen, damit maskierte Felder nicht gelöscht werden.
  for (const key of Object.keys(partial)) {
    const field = config.FIELD_BY_KEY.get(key);
    if (field && field.secret && (partial[key] === '' || partial[key]
        == null)) {
      delete partial[key];
    }
  }

  const errors = validate(partial);
  if (errors.length) {
    return res.status(400).json({errors});
  }

  const {restartRequired} = config.update(partial);
  logger.info(`Config updated via web UI: ${Object.keys(partial).join(', ')}`);
  res.json({ok: true, restartRequired});
});

module.exports = router;
