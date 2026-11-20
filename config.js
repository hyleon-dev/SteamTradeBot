const fs = require('fs');
const path = require('path');

const ENV_PATH = process.env.CONFIG_ENV_PATH || path.join(__dirname, '.env');

require('dotenv').config({ path: ENV_PATH });

const parseIds = (str) => (str ? str.split(',').map(s => s.trim()).filter(Boolean) : []);

// Field metadata: controls parsing, masking (secret) and if a change
// applies at runtime (hotReload) or needs a restart.
const FIELDS = [
    { key: 'port', env: 'PORT', type: 'string', secret: false, hotReload: false },
    { key: 'steam_username', env: 'STEAM_USERNAME', type: 'string', secret: false, hotReload: false },
    { key: 'steam_password', env: 'STEAM_PASSWORD', type: 'string', secret: true, hotReload: false },
    { key: 'steam_shared_secret', env: 'STEAM_SHARED_SECRET', type: 'string', secret: true, hotReload: false },
    { key: 'steam_identity_secret', env: 'STEAM_IDENTITY_SECRET', type: 'string', secret: true, hotReload: false },
    { key: 'steam_api_key', env: 'STEAM_API_KEY', type: 'string', secret: true, hotReload: false },
    { key: 'steam_main_account', env: 'STEAM_MAIN_ACCOUNT', type: 'string', secret: false, hotReload: false },
    { key: 'discord_webhook_id', env: 'DISCORD_WEBHOOK_ID', type: 'string', secret: false, hotReload: false },
    { key: 'discord_webhook_token', env: 'DISCORD_WEBHOOK_TOKEN', type: 'string', secret: true, hotReload: false },
    { key: 'uptimekuma_url', env: 'UPTIMEKUMA_URL', type: 'string', secret: false, hotReload: false },
    { key: 'uptimekuma_key', env: 'UPTIMEKUMA_KEY', type: 'string', secret: true, hotReload: false },
    { key: 'prometheus_prefix', env: 'PROMETHEUS_PREFIX', type: 'string', secret: false, hotReload: false },
    // legacyEnv: old variable name. Read only if the new name is not set.
    { key: 'sale_cards_give_1_for_3_app_ids', env: 'SALE_CARDS_GIVE_1_FOR_3_APP_IDS', legacyEnv: 'SALE_MARKET_FEE_APP_ID_GIVE', type: 'ids', secret: false, hotReload: true },
    { key: 'sale_card_get_1_for_2_app_id', env: 'SALE_CARD_GET_1_FOR_2_APP_ID', legacyEnv: 'SALE_MARKET_FEE_APP_ID_GET', type: 'idOrNull', secret: false, hotReload: true },
    // Set rules. They can be combined, see setRules.js.
    { key: 'blocked_app_ids', env: 'BLOCKED_APP_IDS', type: 'ids', secret: false, hotReload: true },
    { key: 'never_give_app_ids', env: 'NEVER_GIVE_APP_IDS', legacyEnv: 'DO_NOT_GIVE_HARD', type: 'ids', secret: false, hotReload: true },
    { key: 'never_get_app_ids', env: 'NEVER_GET_APP_IDS', legacyEnv: 'DO_NOT_GET_HARD', type: 'ids', secret: false, hotReload: true },
    { key: 'only_same_set_swap_app_ids', env: 'ONLY_SAME_SET_SWAP_APP_IDS', type: 'ids', secret: false, hotReload: true },
    { key: 'only_give_1_for_2_app_ids', env: 'ONLY_GIVE_1_FOR_2_APP_IDS', type: 'ids', secret: false, hotReload: true },
    { key: 'only_get_2_for_1_app_ids', env: 'ONLY_GET_2_FOR_1_APP_IDS', type: 'ids', secret: false, hotReload: true },
    { key: 'give_only_duplicates_app_ids', env: 'GIVE_ONLY_DUPLICATES_APP_IDS', type: 'ids', secret: false, hotReload: true },
    { key: 'auto_decline_clear_cases', env: 'AUTO_DECLINE_CLEAR_CASES', type: 'bool', secret: false, hotReload: true, default: false },
    { key: 'ignore_messages_from', env: 'IGNORE_MESSAGES_FROM', type: 'ids', secret: false, hotReload: true },
    // Web UI
    { key: 'web_ui_enabled', env: 'WEB_UI_ENABLED', type: 'bool', secret: false, hotReload: false, default: true },
    { key: 'web_host', env: 'WEB_HOST', type: 'string', secret: false, hotReload: false, default: '127.0.0.1' },
    { key: 'web_auth_token', env: 'WEB_AUTH_TOKEN', type: 'string', secret: true, hotReload: false },
];

const FIELD_BY_KEY = new Map(FIELDS.map(f => [f.key, f]));

// Removed variables. The bot ignores them and warns one time.
const REMOVED_ENV = ['GIVE_ONLY_SAME_SET_DUPLICATES_APP_IDS', 'GET_ONLY_SAME_SET_APP_IDS', 'DO_NOT_GIVE_SOFT', 'DO_NOT_GET_SOFT'];

function parseValue(field, raw) {
    switch (field.type) {
        case 'ids':
            return parseIds(raw);
        case 'idOrNull':
            return raw ? raw : null;
        case 'bool':
            if (raw === undefined || raw === '') return field.default ?? false;
            return !(raw === 'false' || raw === '0');
        default:
            return (raw === undefined || raw === '') ? (field.default ?? raw) : raw;
    }
}

function serialize(field, value) {
    if (value === undefined || value === null) return '';
    // Web UI shows "a, b, c". Store in .env without spaces.
    if (field.type === 'ids') return parseIds(Array.isArray(value) ? value.join(',') : String(value)).join(',');
    if (field.type === 'bool') return (value === true || value === 'true' || value === '1' || value === 1) ? 'true' : 'false';
    return String(value);
}

const warnedLegacy = new Set();

// Returns the raw env value. Falls back to the old name and warns one time.
function readEnv(field) {
    if (process.env[field.env] !== undefined || !field.legacyEnv) return process.env[field.env];
    const legacy = process.env[field.legacyEnv];
    if (legacy !== undefined && !warnedLegacy.has(field.legacyEnv)) {
        warnedLegacy.add(field.legacyEnv);
        console.warn(`Config: ${field.legacyEnv} is deprecated. Rename it to ${field.env} in .env.`);
    }
    return legacy;
}

// Write values from process.env into the exported object.
function refresh() {
    for (const field of FIELDS) {
        config[field.key] = parseValue(field, readEnv(field));
    }
    REMOVED_ENV.forEach(name => {
        if (process.env[name] && !warnedLegacy.has(name)) {
            warnedLegacy.add(name);
            console.warn(`Config: ${name} was removed and is ignored. Use the new set rules (see README).`);
        }
    });
}

// Keep the .env file (comments, other keys). Replace only the changed lines.
function writeEnv(envUpdates) {
    let lines = [];
    if (fs.existsSync(ENV_PATH)) {
        lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
    }
    const seen = new Set();
    const out = lines.map(line => {
        const m = line.match(/^([A-Z0-9_]+)\s*=/);
        if (m && Object.prototype.hasOwnProperty.call(envUpdates, m[1])) {
            seen.add(m[1]);
            return `${m[1]}=${formatEnvValue(envUpdates[m[1]])}`;
        }
        return line;
    });
    for (const [k, v] of Object.entries(envUpdates)) {
        if (!seen.has(k)) out.push(`${k}=${formatEnvValue(v)}`);
    }
    fs.writeFileSync(ENV_PATH, out.join('\n'));
}

function formatEnvValue(value) {
    if (value === '') return '';
    if (/'/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
    if (/[\s#$"]/.test(value)) return `'${value}'`;
    return value;
}

// Apply values from the web UI. Returns the changed fields
// that need a restart.
function update(partial) {
    const envUpdates = {};
    const restartRequired = [];
    for (const [key, value] of Object.entries(partial)) {
        const field = FIELD_BY_KEY.get(key);
        if (!field) continue;
        const serialized = serialize(field, value);
        envUpdates[field.env] = serialized;
        process.env[field.env] = serialized;
        if (!field.hotReload) restartRequired.push(key);
    }
    writeEnv(envUpdates);
    refresh();
    return { restartRequired };
}

// Read .env from disk again (e.g. after an external edit).
function reload() {
    require('dotenv').config({ path: ENV_PATH, override: true });
    refresh();
}

// Description of all fields for the API. Values are NOT masked here.
function describe() {
    return FIELDS.map(field => ({
        key: field.key,
        env: field.env,
        value: config[field.key],
        secret: !!field.secret,
        restartRequired: !field.hotReload,
    }));
}

const config = { FIELDS, FIELD_BY_KEY, refresh, update, reload, describe };
refresh();

module.exports = config;
