const Database = require('better-sqlite3');
const { migrateStatsToTimestamp } = require('./migrations');

const db = new Database(process.env.DB_PATH || 'metrics.db');

// V 1.0 - init / V 1.3 - stats uses timestamp instead of day/month/year/week
db.exec(`
  CREATE TABLE IF NOT EXISTS stats (
    trade_id TEXT PRIMARY KEY,
    timestamp INTEGER,
    gained INTEGER,
    given INTEGER
  );
`);

// V 1.1 - added messages table
db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT,
        sender_id TEXT,
        timestamp TIMESTAMP,
        message_text TEXT,
        PRIMARY KEY (message_id, sender_id)
    );
`);

// V 1.2 - added rich trade history (accepted AND declined offers)
db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
        trade_id TEXT PRIMARY KEY,
        timestamp INTEGER,
        partner_id TEXT,
        partner_name TEXT,
        items_to_receive TEXT,
        items_to_give TEXT,
        receive_count INTEGER,
        give_count INTEGER,
        accepted INTEGER,
        reason TEXT
    );
`);

// Migrate existing DBs from the old stats schema (day/month/year/week) to timestamp.
// Must run before the prepare() statements, so the timestamp column exists.
migrateStatsToTimestamp(db);

const upsertStat = db.prepare(`
    INSERT OR REPLACE INTO stats (trade_id, timestamp, gained, given)
    VALUES (@trade_id, @timestamp, @gained, @given)
`);

const upsertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages (message_id, sender_id, timestamp, message_text)
    VALUES (@message_id, @sender_id, DATETIME(@unixtimestemp, 'unixepoch'), @message_text)
`)

const upsertTrade = db.prepare(`
    INSERT OR REPLACE INTO trades
        (trade_id, timestamp, partner_id, partner_name, items_to_receive, items_to_give,
         receive_count, give_count, accepted, reason)
    VALUES
        (@trade_id, @timestamp, @partner_id, @partner_name, @items_to_receive, @items_to_give,
         @receive_count, @give_count, @accepted, @reason)
`);

function logOffer(offer) {
    upsertStat.run({
        trade_id: offer.id,
        timestamp: offer.created ? offer.created.getTime() : Date.now(),
        gained: offer.itemsToReceive.length,
        given: offer.itemsToGive.length,
    });
}

function logMessage(data) {
    upsertMessage.run(data);
}

// data: { trade_id, timestamp (unix ms), partner_id, partner_name,
//         itemsToReceive: [], itemsToGive: [], accepted: bool, reason: string[]|null }
function logTrade(data) {
    upsertTrade.run({
        trade_id: String(data.trade_id),
        timestamp: data.timestamp,
        partner_id: data.partner_id ?? null,
        partner_name: data.partner_name ?? null,
        items_to_receive: JSON.stringify(data.itemsToReceive ?? []),
        items_to_give: JSON.stringify(data.itemsToGive ?? []),
        receive_count: (data.itemsToReceive ?? []).length,
        give_count: (data.itemsToGive ?? []).length,
        accepted: data.accepted ? 1 : 0,
        reason: data.reason ? JSON.stringify(data.reason) : null,
    });
}

function parseTradeRow(row) {
    return {
        ...row,
        accepted: !!row.accepted,
        items_to_receive: JSON.parse(row.items_to_receive || '[]'),
        items_to_give: JSON.parse(row.items_to_give || '[]'),
        reason: row.reason ? JSON.parse(row.reason) : null,
    };
}

function getTrades({ from, to, accepted, limit = 100 } = {}) {
    const clauses = [];
    const params = {};
    if (from != null) { clauses.push('timestamp >= @from'); params.from = from; }
    if (to != null) { clauses.push('timestamp <= @to'); params.to = to; }
    if (accepted != null) { clauses.push('accepted = @accepted'); params.accepted = accepted ? 1 : 0; }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.limit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const rows = db.prepare(
        `SELECT * FROM trades ${where} ORDER BY timestamp DESC LIMIT @limit`
    ).all(params);
    return rows.map(parseTradeRow);
}

const GROUP_EXPR = {
    day: `strftime('%Y-%m-%d', datetime(timestamp/1000, 'unixepoch'))`,
    week: `strftime('%Y-W%W', datetime(timestamp/1000, 'unixepoch'))`,
    month: `strftime('%Y-%m', datetime(timestamp/1000, 'unixepoch'))`,
};

function getTradeAggregates({ groupBy = 'day' } = {}) {
    const expr = GROUP_EXPR[groupBy] || GROUP_EXPR.day;
    return db.prepare(`
        SELECT ${expr} AS bucket,
               COUNT(*) AS trades,
               SUM(accepted) AS accepted,
               SUM(CASE WHEN accepted = 1 THEN receive_count ELSE 0 END) AS gained,
               SUM(CASE WHEN accepted = 1 THEN give_count ELSE 0 END) AS given
        FROM trades
        GROUP BY bucket
        ORDER BY bucket ASC
    `).all();
}

function getMessages({ limit = 100 } = {}) {
    const lim = Math.max(1, Math.min(Number(limit) || 100, 1000));
    return db.prepare(
        `SELECT * FROM messages ORDER BY timestamp DESC LIMIT @limit`
    ).all({ limit: lim });
}

module.exports = { db, logOffer, logMessage, logTrade, getTrades, getTradeAggregates, getMessages };
