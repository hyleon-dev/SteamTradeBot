const Database = require('better-sqlite3');
const {format, getISOWeek} = require("date-fns");

const db = new Database('metrics.db');

// V 1.0 - init
db.exec(`
  CREATE TABLE IF NOT EXISTS stats (
    trade_id TEXT PRIMARY KEY,
    day TEXT,
    month TEXT,
    year TEXT,
    week TEXT,
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

const upsertStat = db.prepare(`
    INSERT INTO stats (trade_id, day, month, year, week, gained, given)
    VALUES (@trade_id, @day, @month, @year, @week, @gained, @given)
`);

const upsertMessage = db.prepare(`
    INSERT INTO messages (message_id, sender_id, timestamp, message_text)
    VALUES (@message_id, @sender_id, DATETIME(@unixtimestemp, 'unixepoch'), @message_text)
`)

function logOffer(offer) {
    const trade_id = offer.id;
    const day = format(offer.created, 'dd');
    const month = format(offer.created, 'MM');
    const year = format(offer.created, 'yyyy');
    const week = getISOWeek(offer.created);
    const gained = offer.itemsToReceive.length;
    const given = offer.itemsToGive.length;
    upsertStat.run({trade_id, day, month, year, week, gained, given});
}

function logMessage(data) {
    upsertMessage.run(data);
}

module.exports = { db, logOffer, logMessage };
