const fs = require('fs');
const path = require('path');

const ENV_PATH = process.env.CONFIG_ENV_PATH || path.join(__dirname, '.env');

require('dotenv').config({ path: ENV_PATH });

const parseIds = (str) => (str ? str.split(',').map(s => s.trim()).filter(Boolean) : []);

// Feld-Metadaten: steuern Parsing, Maskierung (secret) und ob eine Änderung
// zur Laufzeit übernommen werden kann (hotReload) oder einen Neustart braucht.
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
    { key: 'sale_market_fee_app_id_give', env: 'SALE_MARKET_FEE_APP_ID_GIVE', type: 'ids', secret: false, hotReload: true },
    { key: 'sale_market_fee_app_id_get', env: 'SALE_MARKET_FEE_APP_ID_GET', type: 'idOrNull', secret: false, hotReload: true },
    { key: 'do_not_give_hard', env: 'DO_NOT_GIVE_HARD', type: 'ids', secret: false, hotReload: true },
    { key: 'do_not_get_hard', env: 'DO_NOT_GET_HARD', type: 'ids', secret: false, hotReload: true },
    { key: 'do_not_give_soft', env: 'DO_NOT_GIVE_SOFT', type: 'ids', secret: false, hotReload: true },
    { key: 'do_not_get_soft', env: 'DO_NOT_GET_SOFT', type: 'ids', secret: false, hotReload: true },
    { key: 'ignore_messages_from', env: 'IGNORE_MESSAGES_FROM', type: 'ids', secret: false, hotReload: true },
    // Web UI
    { key: 'web_ui_enabled', env: 'WEB_UI_ENABLED', type: 'bool', secret: false, hotReload: false, default: true },
    { key: 'web_host', env: 'WEB_HOST', type: 'string', secret: false, hotReload: false, default: '127.0.0.1' },
    { key: 'web_auth_token', env: 'WEB_AUTH_TOKEN', type: 'string', secret: true, hotReload: false },
];

const FIELD_BY_KEY = new Map(FIELDS.map(f => [f.key, f]));

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
    if (field.type === 'ids') return Array.isArray(value) ? value.join(',') : String(value);
    if (field.type === 'bool') return (value === true || value === 'true' || value === '1' || value === 1) ? 'true' : 'false';
    return String(value);
}

// Werte aus process.env in das exportierte Objekt schreiben.
function refresh() {
    for (const field of FIELDS) {
        config[field.key] = parseValue(field, process.env[field.env]);
    }
}

// .env-Datei erhalten (Kommentare/andere Keys) und nur betroffene Zeilen ersetzen.
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

// Werte aus der Web-UI übernehmen. Gibt zurück, welche geänderten Felder
// einen Neustart benötigen.
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

// .env erneut von der Platte lesen (z.B. nach externer Bearbeitung).
function reload() {
    require('dotenv').config({ path: ENV_PATH, override: true });
    refresh();
}

// Beschreibung aller Felder für die API (Werte werden hier NICHT maskiert).
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
