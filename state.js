// Shared runtime state of the bot.
// index.js updates this state on Steam events. The web API reads from it.
const state = {
  startedAt: Date.now(),
  loggedOn: false,
  reconnectAttempts: 0,
  lastHeartbeat: null,   // Unix ms of the last successful Uptime Kuma ping
  lastError: null,       // { message, at } of the last Steam client error
};

function get() {
  return {...state, uptimeMs: Date.now() - state.startedAt};
}

function set(partial) {
  Object.assign(state, partial);
}

module.exports = {get, set};
