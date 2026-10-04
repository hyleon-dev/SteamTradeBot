const prom = require('prom-client');
const config = require('./config');
const { db } = require('./db');

const promPrefix = (config.prometheus_prefix || 'steamtradebot').toUpperCase() + '_';
prom.collectDefaultMetrics({ prefix: promPrefix });

// Start of the period (local midnight) as Unix ms.
function startOf(period) {
    const now = new Date();
    if (period === 'year') return new Date(now.getFullYear(), 0, 1).getTime();
    if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    if (period === 'day') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return 0;
}

// col: 'count' | 'given' | 'gained'; period: 'year'|'month'|'day'|null (= total)
function statGauge(name, help, col, period) {
    const select = col === 'count' ? 'count(*)' : `sum(${col})`;
    const stmt = db.prepare(period
        ? `select ${select} from stats where timestamp >= @from`
        : `select ${select} from stats`);
    new prom.Gauge({
        name: promPrefix + name,
        help,
        collect() {
            const data = period ? stmt.pluck().get({ from: startOf(period) }) : stmt.pluck().get();
            this.set(data || 0);
        },
    });
}

statGauge('TOTAL_TRADES', 'Total number of trades', 'count', null);
statGauge('TOTAL_CARDS_GIVEN', 'Total number of cards given', 'given', null);
statGauge('TOTAL_CARDS_GAINED', 'Total number of cards gained', 'gained', null);

statGauge('TRADES_THIS_YEAR', 'Number of trades for current year', 'count', 'year');
statGauge('CARDS_GIVEN_THIS_YEAR', 'Number of cards given for current year', 'given', 'year');
statGauge('CARDS_GAINED_THIS_YEAR', 'Number of cards gained for current year', 'gained', 'year');

statGauge('TRADES_THIS_MONTH', 'Number of trades for current month', 'count', 'month');
statGauge('CARDS_GIVEN_THIS_MONTH', 'Number of cards given for current month', 'given', 'month');
statGauge('CARDS_GAINED_THIS_MONTH', 'Number of cards gained for current month', 'gained', 'month');

statGauge('TRADES_TODAY', 'Number of trades for current day', 'count', 'day');
statGauge('CARDS_GIVEN_TODAY', 'Number of cards given for current day', 'given', 'day');
statGauge('CARDS_GAINED_TODAY', 'Number of cards gained for current day', 'gained', 'day');

const errorCounter = new prom.Counter({
    name: promPrefix + 'CURRENT_RUN_ERRORS',
    help: 'Number of errors on current run'
})
const reconnectCounter = new prom.Counter({
    name: promPrefix + 'CURRENT_RUN_RECONNECTS',
    help: 'Number of reconnects on current run'
})

// Prometheus /metrics endpoint. web/server.js mounts it.
function mountMetrics(app) {
    app.get('/metrics', async (req, res) => {
        try {
            res.set('Content-Type', prom.register.contentType);
            res.end(await prom.register.metrics());
        } catch (ex) {
            res.status(500).end(String(ex));
        }
    });
}

module.exports = { errorCounter, reconnectCounter, mountMetrics, register: prom.register };
