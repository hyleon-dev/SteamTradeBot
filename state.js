// Geteilter Laufzeit-Status des Bots.
// index.js aktualisiert diesen State bei Steam-Events; die Web-API liest daraus.
const state = {
  startedAt: Date.now(),
  loggedOn: false,
  reconnectAttempts: 0,
  lastHeartbeat: null,   // Unix-ms des letzten erfolgreichen Uptime-Kuma-Pings
  lastError: null,       // { message, at } des letzten Steam-Client-Fehlers
};

function get() {
  return {...state, uptimeMs: Date.now() - state.startedAt};
}

function set(partial) {
  Object.assign(state, partial);
}

module.exports = {get, set};
