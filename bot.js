// Bridge between the web routes and the Steam bot.
// index.js registers the functions at start. Routes call them via call().
// So the routes do not need to require index.js.
const handlers = {};

function register(fns) {
    Object.assign(handlers, fns);
}

// Throws if the bot did not register the function (e.g. in tests or headless start order).
function call(name, ...args) {
    if (typeof handlers[name] !== 'function') {
        throw new Error(`Bot function '${name}' is not available`);
    }
    return handlers[name](...args);
}

module.exports = { register, call };
