// Standalone migration: converts the stats table from day/month/year/week to timestamp.
// Usage:  node scripts/migrate-stats-timestamp.js   (respects DB_PATH)
// Note:   Stop the bot first. Nothing else may write to the DB at the same time.
const path = require('path');
const Database = require('better-sqlite3');
const {migrateStatsToTimestamp} = require('../migrations');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'metrics.db');
const db = new Database(dbPath);

const columns = () => db.prepare('PRAGMA table_info(stats)').all().map(
    c => c.name);

console.log(`DB: ${dbPath}`);
console.log('stats columns before:',
    columns().join(', ') || '(no stats table)');

const result = migrateStatsToTimestamp(db);

console.log('stats columns after: ', columns().join(', '));
console.log(result.migrated
    ? `✅ Migrated: ${result.rows} rows converted to timestamp.`
    : 'ℹ️  Nothing to migrate (schema is already up to date).');

db.close();
