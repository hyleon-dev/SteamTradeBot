const prom = require('prom-client');
const express = require('express');
const config = require('./config.json');
const {format} = require("date-fns");
const logger = require('./logger');
const { db } = require('./db');

const promPrefix = config.prometheus_prefix.toUpperCase() + '_';
prom.collectDefaultMetrics({ prefix: promPrefix });

new prom.Gauge({
    name: promPrefix + 'TOTAL_TRADES',
    help: 'Total number of trades',
    collect() {
        const data = db.prepare('select count(*) from stats;').pluck().get();
        this.set(data || 0);
    }
});
new prom.Gauge({
    name: promPrefix + 'TOTAL_CARDS_GIVEN',
    help: 'Total number of cards given',
    collect() {
        const data = db.prepare('select sum(given) from stats;').pluck().get();
        this.set(data || 0);
    }
});
new prom.Gauge({
    name: promPrefix + 'TOTAL_CARDS_GAINED',
    help: 'Total number of cards gained',
    collect() {
        const data = db.prepare('select sum(gained) from stats;').pluck().get();
        this.set(data || 0);
    }
});

new prom.Gauge({
    name: promPrefix + 'TRADES_THIS_YEAR',
    help: 'Number of trades for current year',
    collect() {
        const data = db.prepare(`
            select count(*)
            from stats
            where year == '${format(new Date(), 'yyyy')}'
        `).pluck().get();
        this.set(data || 0);
    }
});
new prom.Gauge({
    name: promPrefix + 'CARDS_GIVEN_THIS_YEAR',
    help: 'Number of cards given for current year',
    collect() {
        const data = db.prepare(`
            select sum(given)
            from stats
            where year == '${format(new Date(), 'yyyy')}'
        `).pluck().get();
        this.set(data || 0);
    }
});
new prom.Gauge({
    name: promPrefix + 'CARDS_GAINED_THIS_YEAR',
    help: 'Number of cards gained for current year',
    collect() {
        const data = db.prepare(`
            select sum(gained)
            from stats
            where year == '${format(new Date(), 'yyyy')}'
        `).pluck().get();
        this.set(data || 0);
    }
});

new prom.Gauge({
    name: promPrefix + 'TRADES_THIS_MONTH',
    help: 'Number of trades for current month',
    collect() {
        const data = db.prepare(`
            select count(*)
            from stats
            where year == '${format(new Date(), 'yyyy')}'
              and month == '${format(new Date(), 'MM')}'
        `).pluck().get();
        this.set(data || 0);
    }
});
new prom.Gauge({
    name: promPrefix + 'CARDS_GIVEN_THIS_MONTH',
    help: 'Number of cards given for current month',
    collect() {
        const data = db.prepare(`
            select sum(given)
            from stats
            where year == '${format(new Date(), 'yyyy')}'
              and month == '${format(new Date(), 'MM')}'
        `).pluck().get();
        this.set(data || 0);
    }
});
new prom.Gauge({
    name: promPrefix + 'CARDS_GAINED_THIS_MONTH',
    help: 'Number of cards gained for current month',
    collect() {
        const data = db.prepare(`
            select sum(gained)
            from stats
            where year == '${format(new Date(), 'yyyy')}'
              and month == '${format(new Date(), 'MM')}'
        `).pluck().get();
        this.set(data || 0);
    }
});

new prom.Gauge({
    name: promPrefix + 'TRADES_TODAY',
    help: 'Number of trades for current day',
    collect() {
        const data = db.prepare(`
            select count(*)
            from stats
            where year == '${format(new Date(), 'yyyy')}'
              and month == '${format(new Date(), 'MM')}'
              and day == '${format(new Date(), 'dd')}'
        `).pluck().get();
        this.set(data || 0);
    }
});
new prom.Gauge({
    name: promPrefix + 'CARDS_GIVEN_TODAY',
    help: 'Number of cards given for current day',
    collect() {
        const data = db.prepare(`
            select sum(given)
            from stats
            where year == '${format(new Date(), 'yyyy')}'
              and month == '${format(new Date(), 'MM')}'
              and day == '${format(new Date(), 'dd')}'
        `).pluck().get();
        this.set(data || 0);
    }
});
new prom.Gauge({
    name: promPrefix + 'CARDS_GAINED_TODAY',
    help: 'Number of cards gained for current day',
    collect() {
        const data = db.prepare(`
            select sum(gained)
            from stats
            where year == '${format(new Date(), 'yyyy')}'
              and month == '${format(new Date(), 'MM')}'
              and day == '${format(new Date(), 'dd')}'
        `).pluck().get();
        this.set(data || 0);
    }
});

const errorCounter = new prom.Counter({
    name: promPrefix + 'CURRENT_RUN_ERRORS',
    help: 'Number of errors on current run'
})
const reconnectCounter = new prom.Counter({
    name: promPrefix + 'CURRENT_RUN_RECONNECTS',
    help: 'Number of reconnects on current run'
})

// metric end point
const app = express();
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', prom.register.contentType);
        res.end(await prom.register.metrics());
    } catch (ex) {
        res.status(500).end(ex);
    }
});
app.listen(parseInt(config.port), () => logger.info('Server running on port ' + config.port));

module.exports = { errorCounter, reconnectCounter };
