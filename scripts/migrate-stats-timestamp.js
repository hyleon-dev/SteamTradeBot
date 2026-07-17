// Standalone-Migration: konvertiert die stats-Tabelle von day/month/year/week auf timestamp.
// Nutzung:  node scripts/migrate-stats-timestamp.js   (respektiert DB_PATH)
// Hinweis:  Bot vorher stoppen – die DB sollte nicht parallel geschrieben werden.
const path = require('path');
const Database = require('better-sqlite3');
const {migrateStatsToTimestamp} = require('../migrations');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'metrics.db');
const db = new Database(dbPath);

const columns = () => db.prepare('PRAGMA table_info(stats)').all().map(
    c => c.name);

console.log(`DB: ${dbPath}`);
console.log('stats-Spalten vorher :',
    columns().join(', ') || '(keine stats-Tabelle)');

const result = migrateStatsToTimestamp(db);

console.log('stats-Spalten nachher:', columns().join(', '));
console.log(result.migrated
    ? `✅ Migriert: ${result.rows} Zeilen auf timestamp umgestellt.`
    : 'ℹ️  Nichts zu migrieren (Schema ist bereits aktuell).');

db.close();
