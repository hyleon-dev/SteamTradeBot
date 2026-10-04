const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const SteamCommunity = require("steamcommunity");
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamID = require('steamid');
const config = require('./config');
const logger = require('./logger');
const state = require('./state');
const { db, logOffer, logMessage, logTrade } = require('./db');
const { errorCounter, reconnectCounter } = require('./metrics');
const { startServer } = require('./web/server');
const { sendDiscordMessage } = require('./discord');
const events = require('./events');
const { mapSteamOffer, validateOffer, itemsToText } = require('./utils');

const steamClient = new SteamUser();
const community = new SteamCommunity();
const manager = new TradeOfferManager({
    "steam": steamClient,
    "community": community,
    "language": "en"
});

// Steam
const loginDetails = {
    accountName: config.steam_username,
    password: config.steam_password,
    logonID: Math.floor(Math.random() * 1000) + 1
};
const identitySecret = config.steam_identity_secret;

// Uptime Kuma monitoring
const pushURL = `${config.uptimekuma_url}/api/push/${config.uptimekuma_key}?status=up&msg=OK&ping=`;
// Catch errors here. An unhandled rejection stops the process via winston.
const heartbeat = async () => {
    try {
        const response = await fetch(pushURL);
        if (response.ok) state.set({ lastHeartbeat: Date.now() });
        else logger.warn(`Uptime Kuma heartbeat failed: ${response.status} ${response.statusText}`);
    } catch (err) {
        logger.warn(`Uptime Kuma heartbeat failed: ${err.message}`);
    }
};
heartbeat();
setInterval(heartbeat, 60 * 1000);

// Start web/metrics server (dashboard only if WEB_UI_ENABLED, /metrics always)
startServer();

// Read trade rules from config for each offer (supports hot reload)
function getTradeRules() {
    return {
        saleMarketFeeAppIdGive: config.sale_market_fee_app_id_give.map(String),
        saleMarketFeeAppIdGet: config.sale_market_fee_app_id_get,
        hardBlacklist: { get: config.do_not_get_hard.map(String), give: config.do_not_give_hard.map(String) },
        softBlacklist: { get: config.do_not_get_soft.map(String), give: config.do_not_give_soft.map(String) },
    };
}

// User cache to avoid redundant Steam API calls per trade/message
const userCache = new Map();
const USER_CACHE_TTL = 5 * 60 * 1000;

async function loadUserFromAccountId(steamId) {
    const cached = userCache.get(steamId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    try {
        const response = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${config.steam_api_key}&steamids=${steamId}`);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const data = (await response.json())?.response?.players?.[0];
        if (!data) throw new Error('player not found');
        userCache.set(steamId, { data, expiresAt: Date.now() + USER_CACHE_TTL });
        return data;
    } catch (err) {
        // Fallback without cache. Offer and chat handling must not fail because of this.
        logger.warn(`Could not load user ${steamId}: ${err.message}`);
        return { steamid: String(steamId), personaname: String(steamId) };
    }
}

// Reconnect with exponential backoff (max 5 minutes between attempts)
let wasConnected = false;
let reconnectAttempts = 0;

function scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 5 * 60 * 1000);
    reconnectAttempts++;
    state.set({ reconnectAttempts });
    logger.info(`Scheduling reconnect in ${delay / 1000}s (attempt ${reconnectAttempts})`);
    reconnectCounter.inc();
    setTimeout(() => steamClient.logOn(loginDetails), delay);
}

// Graceful shutdown
function shutdown(signal) {
    logger.info(`${signal} received, shutting down gracefully`);
    steamClient.logOff();
    db.close();
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Disables asking for Steam Guard Code
steamClient.setOption("promptSteamGuardCode", false);

steamClient.logOn(loginDetails);

// Log in
steamClient.on('loggedOn', () => {
    reconnectAttempts = 0;
    // steam-user has no 'connected' event. So set the flag here.
    wasConnected = true;
    state.set({ loggedOn: true, reconnectAttempts: 0 });
    logger.info(`Logged into Steam`);
    sendDiscordMessage("🤖 Beep boop! I'm alive!")
    steamClient.setPersona(SteamUser.EPersonaState.Online);
});

steamClient.on("error", function (e) {
    logger.error(`Steam client error: ${e}`);
    state.set({ lastError: { message: e.message, at: Date.now() }, loggedOn: false });
    errorCounter.inc();

    if (e.message.includes("Invalid Password") || e.message.includes("Invalid Auth Code")) {
        logger.error('Fatal auth error, shutting down');
        db.close();
        process.exit(1);
        return;
    }
    scheduleReconnect();
});

// If last Steam Guard Code was wrong, here a new one is created
steamClient.on("steamGuard", function (domain, callback, lastCodeWrong) {
    const steamGuardWaitTime = 31;
    if (lastCodeWrong) {
        logger.warn(`Last Steam Guard Code was incorrect, retrying in ${steamGuardWaitTime} seconds`);
    } else {
        logger.info(`Generating new Steam Guard Code`)
    }
    setTimeout(function () {
        callback(SteamTotp.generateAuthCode(config.steam_shared_secret));
    }, steamGuardWaitTime * 1000);
});

steamClient.on('webSession', (sessionid, cookies) => {
    manager.setCookies(cookies);
    community.setCookies(cookies);
});

// Web session expired: get new cookies. The Steam client stays logged in.
community.on('sessionExpired', () => {
    logger.warn('Web session expired, refreshing');
    if (steamClient.steamID) steamClient.webLogOn();
});

steamClient.on('disconnected', () => {
    state.set({ loggedOn: false });
    // steam-user reconnects by itself after 'disconnected' (autoRelogin).
    // An own logOn() here throws "Already logged on" and stops the process.
    if (wasConnected) {
        logger.info(`Connection lost, steam-user reconnects automatically`);
        sendDiscordMessage("🤖 Beep boop! Good night!")
    }
    wasConnected = false;
});

// Steam chat message forwarding
steamClient.chat.on('friendMessage', (msg) => {
    handleFriendMessage(msg).catch(err => {
        logger.error(`Failed to handle friend message: ${err.stack || err}`);
        errorCounter.inc();
    });
});

async function handleFriendMessage(msg) {

    const userLinkPart1 = `https://steamcommunity.com/profiles/`
    const uniqueId = `${msg.server_timestamp.getTime()}_${msg.ordinal}`;
    const steamID64 = msg.steamid_friend.getSteamID64();

    if (config.ignore_messages_from.includes(steamID64)) {
        logger.debug(`Message from ${steamID64} ignored`);
        return;
    }

    if (msg.message.startsWith('[tradeoffer') && msg.message.endsWith('[/tradeoffer]')) {
        logger.debug(`Trade offer message from ${steamID64} ignored`);
        return;
    }

    const user = await loadUserFromAccountId(steamID64);
    logger.info(`Message from ${user.personaname} (${steamID64}) received: '${msg.message}'`);

    logMessage({
        message_id: uniqueId,
        sender_id: steamID64,
        unixtimestemp: msg.server_timestamp.getTime() / 1000,
        message_text: msg.message
    });

    await steamClient.chat.sendFriendMessage(msg.steamid_friend, `Please use main account for communication: ${userLinkPart1}${config.steam_main_account}`);
    await steamClient.chat.sendFriendMessage(config.steam_main_account, `Message from ${user.personaname}: '${msg.message}' \n ${userLinkPart1}${steamID64}`);
}

manager.on('newOffer', (steamOffer) => {
    handleNewOffer(steamOffer).catch(err => {
        logger.error(`Failed to handle offer ${steamOffer.id}: ${err.stack || err}`);
        errorCounter.inc();
        sendDiscordMessage(`❌ Error while handling offer ${steamOffer.id}. Please check manually.`);
    });
});

async function handleNewOffer(steamOffer) {

    const partnerSteamId = SteamID.fromIndividualAccountID(steamOffer.partner.accountid);
    let tradePartner = await loadUserFromAccountId(partnerSteamId.getSteamID64());

    logger.info(`Start of offer validation for ${steamOffer.id} from ${tradePartner.personaname} (${tradePartner.steamid})`);

    // Local array per offer. Prevents race conditions when multiple offers arrive concurrently.
    const lines = [];
    lines.push(`🆕 Offer from ${tradePartner.personaname} received.`);
    lines.push('\n');
    lines.push(`➡️ The Bot will receive ${steamOffer.itemsToReceive.length} cards`);
    lines.push(`⬅️ The Bot will give ${steamOffer.itemsToGive.length} cards`);
    lines.push('\n');

    const offer = mapSteamOffer(steamOffer);
    logger.debug(`ItemsToReceive: (${offer.itemsToReceive.length}) ${itemsToText(offer.itemsToReceive)}`);
    logger.debug(`ItemsToGive: (${offer.itemsToGive.length}) ${itemsToText(offer.itemsToGive)}`);

    const result = validateOffer(offer, getTradeRules());
    lines.push(...result.discordLines);

    logger.debug(`Trade will be accepted: ${result.accepted}`);

    logTrade({
        trade_id: steamOffer.id,
        timestamp: steamOffer.created ? steamOffer.created.getTime() : Date.now(),
        partner_id: tradePartner.steamid,
        partner_name: tradePartner.personaname,
        itemsToReceive: offer.itemsToReceive,
        itemsToGive: offer.itemsToGive,
        accepted: result.accepted,
        reason: result.accepted ? null : result.errorLines,
    });
    // Web UI reloads the trade list live.
    events.emit('trade', { trade_id: String(steamOffer.id), accepted: result.accepted });

    if (result.accepted) {
        lines.push('✅ Trade will be accepted!');
        acceptOffer(steamOffer);
    } else {
        logger.warn(`Can't validate offer ${steamOffer.id}, please check manually`);
        lines.push('❌ Trade will not be accepted! Please check manually.');
        lines.push(...result.errorLines);
    }

    lines.push('---');
    sendDiscordMessage(lines.join('\n'));
    logger.info(`End of offer validation for ${steamOffer.id}`);
}

const MAX_ACCEPT_ATTEMPTS = 3;

function acceptOffer(offer, attempt = 0) {
    offer.accept((err, status) => {
        if (!err && status !== 'pending') {
            // Bot gives nothing: Steam needs no mobile confirmation.
            logger.info(`Offer ${offer.id} accepted by bot (no confirmation needed)`);
            logOffer(offer);
        } else if (!err) {
            logger.info(`Offer ${offer.id} accepted by bot (awaiting Mobile confirmation)`);
            community.acceptConfirmationForObject(identitySecret, offer.id, (err) => {
                if (err) {
                    logger.error(`Failed to confirm offer ${offer.id}: ${err}`)
                } else {
                    logger.info(`Offer ${offer.id} confirmed via Steam Guard Mobile Authenticator`);
                    logOffer(offer);
                }
            });
        } else if (err.message === "Not Logged In") {
            if (attempt >= MAX_ACCEPT_ATTEMPTS) {
                logger.error(`Failed to accept offer ${offer.id} after ${MAX_ACCEPT_ATTEMPTS} attempts`);
                sendDiscordMessage(`❌ Failed to accept offer ${offer.id} after ${MAX_ACCEPT_ATTEMPTS} session retries.`);
                return;
            }
            reconnectCounter.inc();
            // Only refresh the web session. logOff() + logOn() right after each other throws
            // "Already logged on", because steamID is still set during logOn.
            logger.warn(`Session timed out (attempt ${attempt + 1}/${MAX_ACCEPT_ATTEMPTS}), refreshing web session`);
            if (steamClient.steamID) steamClient.webLogOn();
            setTimeout(() => acceptOffer(offer, attempt + 1), 40000);
        } else {
            logger.error(`Failed to accept offer ${offer.id}: ${err.message}`);
            sendDiscordMessage(`❌ Failed to accept offer ${offer.id}: ${err.message}`);
        }
    });
}
