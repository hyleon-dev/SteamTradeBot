const os = require('os');
const path = require('path');
const fs = require('fs');

// Fresh file DB per test run, so metrics.db is not touched.
const TMP_DB = path.join(os.tmpdir(), `stb-test-${process.pid}.db`);
process.env.DB_PATH = TMP_DB;

const Database = require('better-sqlite3');
const { migrateStatsToTimestamp } = require('./migrations');
const { logTrade, getTrades, getTradeAggregates, logOffer, db } = require('./db');

afterAll(() => {
    db.close();
    try { fs.unlinkSync(TMP_DB); } catch { /* ignore */ }
});

const baseTrade = (over = {}) => ({
    trade_id: 't1',
    timestamp: Date.UTC(2026, 0, 15, 12, 0, 0),
    partner_id: '765',
    partner_name: 'Alice',
    itemsToReceive: [{ appId: '1', name: 'A' }, { appId: '1', name: 'B' }],
    itemsToGive: [{ appId: '2', name: 'C' }],
    accepted: true,
    reason: null,
    ...over,
});

describe('logTrade / getTrades', () => {
    test('stores a trade with parsed items and counts', () => {
        logTrade(baseTrade());
        const [t] = getTrades({ limit: 10 });
        expect(t.trade_id).toBe('t1');
        expect(t.accepted).toBe(true);
        expect(t.receive_count).toBe(2);
        expect(t.give_count).toBe(1);
        expect(t.items_to_receive).toHaveLength(2);
        expect(t.items_to_give[0].name).toBe('C');
    });

    test('INSERT OR REPLACE: same trade_id overwrites instead of throwing', () => {
        logTrade(baseTrade({ accepted: false, reason: ['Cross trading does not add up'] }));
        const rows = getTrades({ limit: 10 });
        expect(rows.filter(r => r.trade_id === 't1')).toHaveLength(1);
        const t = rows.find(r => r.trade_id === 't1');
        expect(t.accepted).toBe(false);
        expect(t.reason).toEqual(['Cross trading does not add up']);
    });

    test('Filter accepted', () => {
        logTrade(baseTrade({ trade_id: 't2', accepted: true, reason: null }));
        expect(getTrades({ accepted: true }).every(t => t.accepted)).toBe(true);
        expect(getTrades({ accepted: false }).every(t => !t.accepted)).toBe(true);
    });

    test('time range filter', () => {
        const only = getTrades({ from: Date.UTC(2026, 0, 15), to: Date.UTC(2026, 0, 16) });
        expect(only.length).toBeGreaterThan(0);
        expect(getTrades({ from: Date.UTC(2030, 0, 1) })).toHaveLength(0);
    });
});

describe('getTradeAggregates', () => {
    test('groups by day and sums only accepted cards', () => {
        // Own data on a unique day. Independent of the test order.
        const ts = Date.UTC(2026, 5, 20, 12, 0, 0); // 2026-06-20
        logTrade(baseTrade({ trade_id: 'agg-acc', timestamp: ts, accepted: true }));
        logTrade(baseTrade({ trade_id: 'agg-dec', timestamp: ts, accepted: false, reason: ['x'] }));

        const bucket = getTradeAggregates({ groupBy: 'day' }).find(r => r.bucket === '2026-06-20');
        expect(bucket).toBeDefined();
        expect(bucket.trades).toBe(2);
        expect(bucket.accepted).toBe(1);
        // only the accepted trade counts (2 received / 1 given)
        expect(bucket.gained).toBe(2);
        expect(bucket.given).toBe(1);
    });

    test('includes stats-only trades as accepted', () => {
        logOffer({
            id: 'agg-stats-only',
            created: new Date(Date.UTC(2026, 6, 1, 8, 0, 0)), // 2026-07-01
            itemsToReceive: [{}, {}, {}],
            itemsToGive: [{}],
        });

        const bucket = getTradeAggregates({ groupBy: 'day' }).find(r => r.bucket === '2026-07-01');
        expect(bucket).toEqual({ bucket: '2026-07-01', trades: 1, accepted: 1, gained: 3, given: 1 });
    });

    test('trade in trades and stats counts once', () => {
        const ts = Date.UTC(2026, 6, 2, 8, 0, 0); // 2026-07-02
        logTrade(baseTrade({ trade_id: 'agg-both', timestamp: ts, accepted: true }));
        logOffer({ id: 'agg-both', created: new Date(ts), itemsToReceive: [{}, {}], itemsToGive: [{}] });

        const bucket = getTradeAggregates({ groupBy: 'day' }).find(r => r.bucket === '2026-07-02');
        expect(bucket).toEqual({ bucket: '2026-07-02', trades: 1, accepted: 1, gained: 2, given: 1 });
    });
});

describe('logOffer (stats)', () => {
    test('writes gained/given with timestamp', () => {
        logOffer({
            id: 'o1',
            created: new Date(Date.UTC(2026, 0, 15, 9, 30, 0)),
            itemsToReceive: [{}, {}, {}],
            itemsToGive: [{}],
        });
        const row = db.prepare('SELECT * FROM stats WHERE trade_id = ?').get('o1');
        expect(row.timestamp).toBe(Date.UTC(2026, 0, 15, 9, 30, 0));
        expect(row.gained).toBe(3);
        expect(row.given).toBe(1);
    });
});

describe('migrateStatsToTimestamp', () => {
    test('converts old day/month/year/week schema to timestamp', () => {
        const mem = new Database(':memory:');
        mem.exec(`CREATE TABLE stats (trade_id TEXT PRIMARY KEY, day TEXT, month TEXT, year TEXT, week TEXT, gained INTEGER, given INTEGER);`);
        mem.prepare(`INSERT INTO stats VALUES (@id,@d,@m,@y,@w,@g,@gi)`)
            .run({ id: 'x1', d: '15', m: '01', y: '2026', w: '3', g: 4, gi: 2 });

        const res = migrateStatsToTimestamp(mem);
        expect(res).toEqual({ migrated: true, rows: 1 });

        const cols = mem.prepare('PRAGMA table_info(stats)').all().map(c => c.name);
        expect(cols).toEqual(['trade_id', 'timestamp', 'gained', 'given']);

        const row = mem.prepare('SELECT * FROM stats WHERE trade_id = ?').get('x1');
        expect(row.timestamp).toBe(Date.UTC(2026, 0, 15, 0, 0, 0)); // midnight UTC
        expect(row.gained).toBe(4);
        expect(row.given).toBe(2);

        // Second call = no-op
        expect(migrateStatsToTimestamp(mem)).toEqual({ migrated: false, rows: 0 });
        mem.close();
    });

    test('no-op if schema is already new', () => {
        const mem = new Database(':memory:');
        mem.exec(`CREATE TABLE stats (trade_id TEXT PRIMARY KEY, timestamp INTEGER, gained INTEGER, given INTEGER);`);
        expect(migrateStatsToTimestamp(mem)).toEqual({ migrated: false, rows: 0 });
        mem.close();
    });
});
