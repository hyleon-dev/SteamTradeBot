const { EventEmitter } = require('events');

// Shared event bus between the bot and the web server.
// Events: 'trade' with { trade_id, accepted }.
const events = new EventEmitter();
// Each open web UI tab adds one listener. Disable the leak warning.
events.setMaxListeners(0);

module.exports = events;
