// Idempotent schema migrations for the SQLite DB.

// V 1.3: stats uses a single `timestamp` (Unix ms) instead of day/month/year/week.
// Old data has day precision only → timestamp = midnight (UTC) of that day.
function migrateStatsToTimestamp(db) {
  const cols = db.prepare('PRAGMA table_info(stats)').all().map(c => c.name);

  // No `stats` table or schema is already new → nothing to do.
  if (!cols.includes('year')) {
    return {migrated: false, rows: 0};
  }

  const run = db.transaction(() => {
    const rows = db.prepare('SELECT COUNT(*) FROM stats').pluck().get();
    db.exec(`
        CREATE TABLE stats_migrated
        (
            trade_id  TEXT PRIMARY KEY,
            timestamp INTEGER,
            gained    INTEGER,
            given     INTEGER
        );
    `);
    db.exec(`
        INSERT INTO stats_migrated (trade_id, timestamp, gained, given)
        SELECT trade_id,
               CAST(strftime('%s', year || '-' || month || '-' || day) AS INTEGER) * 1000,
               gained,
               given
        FROM stats;
    `);
    db.exec('DROP TABLE stats;');
    db.exec('ALTER TABLE stats_migrated RENAME TO stats;');
    return rows;
  });

  const rows = run();
  return {migrated: true, rows};
}

module.exports = {migrateStatsToTimestamp};
