const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const SteamCommunity = require("steamcommunity");
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamID = require('steamid');
const config = require('./config');
const logger = require('./logger');
const { db, logOffer, logMessage } = require('./db');
const { errorCounter, reconnectCounter } = require('./metrics');
const { sendDiscordMessage } = require('./discord');
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
const heartbeat = async () => {
    await fetch(pushURL);
};
heartbeat();
setInterval(heartbeat, 60 * 1000);

// Config
const saleMarketFeeAppIdGive = Array.from(config.sale_market_fee_app_id_give).flatMap(id => String(id));
const saleMarketFeeAppIdGet = config.sale_market_fee_app_id_get;
const hardBlacklist = { get: Array.from(config.do_not_get_hard).flatMap(id => String(id)), give: Array.from(config.do_not_give_hard).flatMap(id => String(id)) };
const softBlacklist = { get: Array.from(config.do_not_get_soft).flatMap(id => String(id)), give: Array.from(config.do_not_give_soft).flatMap(id => String(id)) };

// User cache to avoid redundant Steam API calls per trade/message
const userCache = new Map();
const USER_CACHE_TTL = 5 * 60 * 1000;

async function loadUserFromAccountId(steamId) {
    const cached = userCache.get(steamId);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const data = (await (await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${config.steam_api_key}&steamids=${steamId}`)).json())
        .response.players[0];
    userCache.set(steamId, { data, expiresAt: Date.now() + USER_CACHE_TTL });
    return data;
}

// Reconnect with exponential backoff (max 5 minutes between attempts)
let wasConnected = false;
let reconnectAttempts = 0;

function scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 5 * 60 * 1000);
    reconnectAttempts++;
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
    logger.info(`Logged into Steam`);
    sendDiscordMessage("🤖 Beep boop! I'm alive!")
    steamClient.setPersona(SteamUser.EPersonaState.Online);
});

steamClient.on("error", function (e) {
    logger.error(`Steam client error: ${e}`);
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

steamClient.on('connected', () => {
    wasConnected = true;
    logger.info(`Connected to Steam`);
});

steamClient.on('disconnected', () => {
    if (wasConnected) {
        logger.info(`Connection lost, trying to reconnect`);
        sendDiscordMessage("🤖 Beep boop! Good night!")
        scheduleReconnect();
    }
    wasConnected = false;
});

// Steam chat message forwarding
steamClient.chat.on('friendMessage', async (msg) => {

    const userLinkPart1 = `https://steamcommunity.com/profiles/`
    const uniqueId = `${msg.server_timestamp.getTime()}_${msg.ordinal}`;
    const steamID64 = msg.steamid_friend.getSteamID64();
    const user = await loadUserFromAccountId(steamID64);

    if (config.ignore_messages_from.includes(steamID64)) {
        logger.debug(`Message from ${steamID64} ignored`);
        return;
    }

    if (msg.message.startsWith('[tradeoffer') && msg.message.endsWith('[/tradeoffer]')) {
        logger.debug(`Trade offer message from ${steamID64} ignored`);
        return;
    }

    logger.info(`Message from ${user.personaname} (${steamID64}) received: '${msg.message}'`);

    logMessage({
        message_id: uniqueId,
        sender_id: steamID64,
        unixtimestemp: msg.server_timestamp.getTime() / 1000,
        message_text: msg.message
    });

    await steamClient.chat.sendFriendMessage(msg.steamid_friend, `Please use main account for communication: ${userLinkPart1}${config.steam_main_account}`);
    await steamClient.chat.sendFriendMessage(config.steam_main_account, `Message from ${user.personaname}: '${msg.message}' \n ${userLinkPart1}${steamID64}`);
});

manager.on('newOffer', async function (steamOffer) {

    const partnerSteamId = SteamID.fromIndividualAccountID(steamOffer.partner.accountid);
    let tradePartner = await loadUserFromAccountId(partnerSteamId.getSteamID64());

    logger.info(`Start of offer validation for ${steamOffer.id} from ${tradePartner.personaname} (${tradePartner.steamid})`);

    // Local array per offer – prevents race conditions when multiple offers arrive concurrently
    const lines = [];
    lines.push(`🆕 Offer from ${tradePartner.personaname} received.`);
    lines.push('\n');
    lines.push(`➡️ The Bot will receive ${steamOffer.itemsToReceive.length} cards`);
    lines.push(`⬅️ The Bot will give ${steamOffer.itemsToGive.length} cards`);
    lines.push('\n');

    const offer = mapSteamOffer(steamOffer);
    logger.debug(`ItemsToReceive: (${offer.itemsToReceive.length}) ${itemsToText(offer.itemsToReceive)}`);
    logger.debug(`ItemsToGive: (${offer.itemsToGive.length}) ${itemsToText(offer.itemsToGive)}`);

    const result = validateOffer(offer, { hardBlacklist, softBlacklist, saleMarketFeeAppIdGet, saleMarketFeeAppIdGive });
    lines.push(...result.discordLines);

    logger.debug(`Trade will be accepted: ${result.accepted}`);

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
});

const MAX_ACCEPT_ATTEMPTS = 3;

function acceptOffer(offer, attempt = 0) {
    offer.accept((err, status) => {
        if (!err) {
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
            logger.warn(`Session timed out (attempt ${attempt + 1}/${MAX_ACCEPT_ATTEMPTS}), re-logging in`);
            steamClient.logOff();
            steamClient.logOn(loginDetails);
            setTimeout(() => acceptOffer(offer, attempt + 1), 40000);
        } else {
            logger.error(err);
        }
    });
}
