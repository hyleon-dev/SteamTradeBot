const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const SteamCommunity = require("steamcommunity");
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamID = require('steamid');
const config = require('./config');
const logger = require('./logger');
const state = require('./state');
const { db, logOffer, logMessage, logTrade, getTrade, setManualAction, getSetSizes, saveSetSize } = require('./db');
const { errorCounter, reconnectCounter } = require('./metrics');
const { startServer } = require('./web/server');
const { sendDiscordMessage } = require('./discord');
const events = require('./events');
const { mapSteamOffer, validateOffer, itemsToText } = require('./utils');
const { createLock, CardReservations } = require('./reservations');
const { groupCardsBySet, parseSetSize } = require('./inventory');
const { buildSetRules } = require('./setRules');
const bot = require('./bot');

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
        saleMarketFeeAppIdGive: config.sale_cards_give_1_for_3_app_ids.map(String),
        saleMarketFeeAppIdGet: config.sale_card_get_1_for_2_app_id,
        setRules: buildSetRules({
            blocked: config.blocked_app_ids,
            neverGive: config.never_give_app_ids,
            neverGet: config.never_get_app_ids,
            onlySwap: config.only_same_set_swap_app_ids,
            onlyGive: config.only_give_1_for_2_app_ids,
            onlyGet: config.only_get_cross_set_app_ids,
            duplicatesOnly: config.give_only_duplicates_app_ids,
        }),
    };
}

// Loads the Steam community inventory of the bot (app 753, context 6), also non-tradable items.
function loadCardInventory() {
    return new Promise((resolve, reject) => {
        manager.getInventoryContents(753, 6, false, (err, inventory) => (err ? reject(err) : resolve(inventory)));
    });
}

// Counts cards in the bot inventory per market_hash_name.
// Non-tradable cards count too, because they stay in the inventory.
// Returns null on error. Then soft-give cards are not given.
async function loadOwnedCardCounts() {
    try {
        const inventory = await loadCardInventory();
        const counts = new Map();
        inventory.forEach(item => counts.set(item.market_hash_name, (counts.get(item.market_hash_name) || 0) + 1));
        return counts;
    } catch (err) {
        logger.warn(`Could not load bot inventory: ${err.message}`);
        return null;
    }
}

// Offers with soft-give cards are checked one after the other.
// Cards of accepted offers stay reserved until the trade is done.
const runExclusive = createLock();
const reservations = new CardReservations();
// After a done trade the inventory API can show old data for a short time.
const RESERVATION_HOLD_MS = 60 * 1000;

// Trade hold days of partner and bot. Returns null on error.
function loadEscrowDays(steamOffer) {
    return new Promise(resolve => {
        steamOffer.getUserDetails((err, me, them) => {
            if (err || me.escrowDays === undefined) {
                logger.warn(`Could not load trade hold for offer ${steamOffer.id}: ${err ? err.message : 'no data'}`);
                resolve(null);
                return;
            }
            resolve({ me: me.escrowDays, them: them.escrowDays });
        });
    });
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
    state.set({ loggedOn: true, reconnectAttempts: 0, botSteamId: steamClient.steamID.getSteamID64() });
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

// The sender gets the main account hint at most once per cooldown. Forwarding is not affected.
const MAIN_ACCOUNT_HINT_COOLDOWN_MS = 5 * 60 * 1000;
const lastMainAccountHint = new Map(); // steamID64 -> time of last hint (ms)

function shouldSendMainAccountHint(steamID64, now = Date.now()) {
    // Remove old entries. The map stays small.
    lastMainAccountHint.forEach((time, id) => {
        if (now - time >= MAIN_ACCOUNT_HINT_COOLDOWN_MS) lastMainAccountHint.delete(id);
    });
    if (lastMainAccountHint.has(steamID64)) return false;
    lastMainAccountHint.set(steamID64, now);
    return true;
}

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

    // Check and set the cooldown in one step. No await between them, so two fast messages cannot both pass.
    if (shouldSendMainAccountHint(steamID64)) {
        await steamClient.chat.sendFriendMessage(msg.steamid_friend, `Please use main account for communication: ${userLinkPart1}${config.steam_main_account}`);
    } else {
        logger.debug(`Main account hint to ${steamID64} skipped (cooldown)`);
    }
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

    const rules = getTradeRules();
    const softGiveItems = offer.itemsToGive.filter(item => rules.setRules.duplicatesOnly.includes(item.appId));
    const escrow = await loadEscrowDays(steamOffer);

    let result;
    if (softGiveItems.length > 0) {
        // Lock: load inventory, check and reserve as one step
        result = await runExclusive(async () => {
            rules.ownedCounts = reservations.apply(await loadOwnedCardCounts());
            const r = validateOffer(offer, rules);
            if (r.accepted) reservations.reserve(steamOffer.id, softGiveItems);
            return r;
        });
    } else {
        result = validateOffer(offer, rules);
    }
    lines.push(...result.discordLines);

    // Trade hold is only reported. The offer is not declined because of it.
    if (escrow === null) {
        lines.push('⚠️ Could not check trade hold.');
    } else if (escrow.them > 0 || escrow.me > 0) {
        logger.warn(`Offer ${steamOffer.id} has trade hold: partner ${escrow.them} days, bot ${escrow.me} days`);
        lines.push(`⏳ Trade hold: partner ${escrow.them} days, bot ${escrow.me} days.`);
    }

    logger.debug(`Trade will be accepted: ${result.accepted}`);

    // Clear cases are declined only if the switch is on. Hot reload: read config per offer.
    const autoDeclined = !result.accepted && result.autoDecline && config.auto_decline_clear_cases;
    // Mark the reasons that caused the auto decline
    const reasonLines = result.reasons.map(r => (autoDeclined && r.clear ? `${r.text} (clear case)` : r.text));
    const storedReasons = autoDeclined ? [...reasonLines, '🚫 Declined automatically (clear case)'] : reasonLines;
    if (!result.accepted) logger.info(`Offer ${steamOffer.id} reasons: ${reasonLines.join(' | ')}`);

    logTrade({
        trade_id: steamOffer.id,
        timestamp: steamOffer.created ? steamOffer.created.getTime() : Date.now(),
        partner_id: tradePartner.steamid,
        partner_name: tradePartner.personaname,
        itemsToReceive: offer.itemsToReceive,
        itemsToGive: offer.itemsToGive,
        accepted: result.accepted,
        reason: result.accepted ? null : storedReasons,
        reasonCodes: result.reasons.map(r => r.code),
        autoDeclined: autoDeclined,
    });
    // Web UI reloads the trade list live.
    events.emit('trade', { trade_id: String(steamOffer.id), accepted: result.accepted });

    if (result.accepted) {
        lines.push('✅ Trade will be accepted!');
        acceptOffer(steamOffer);
    } else if (autoDeclined) {
        logger.info(`Offer ${steamOffer.id} is a clear case, declining`);
        lines.push('🚫 Trade will be declined automatically!');
        lines.push(`Reasons (${reasonLines.length}):`, ...reasonLines);
        declineOffer(steamOffer);
    } else {
        logger.warn(`Can't validate offer ${steamOffer.id}, please check manually`);
        lines.push('❌ Trade will not be accepted! Please check manually.');
        lines.push(`Reasons (${reasonLines.length}):`, ...reasonLines);
    }

    lines.push('---');
    sendDiscordMessage(lines.join('\n'));
    logger.info(`End of offer validation for ${steamOffer.id}`);
}

// Release the reservation when the offer is done. Active offers keep it.
manager.on('receivedOfferChanged', (offer) => {
    // Web UI reloads the open offers live.
    events.emit('offer', { trade_id: String(offer.id), state: TradeOfferManager.ETradeOfferState[offer.state] });
    if (!reservations.has(offer.id)) return;
    const S = TradeOfferManager.ETradeOfferState;
    if (offer.state === S.Active || offer.state === S.CreatedNeedsConfirmation) return;
    if (offer.state === S.Accepted || offer.state === S.InEscrow) {
        // Cards left the inventory. Keep the reservation until the inventory API shows it.
        setTimeout(() => reservations.release(offer.id), RESERVATION_HOLD_MS);
    } else {
        reservations.release(offer.id);
    }
});

// A decline needs no mobile confirmation.
function declineOffer(offer) {
    offer.decline((err) => {
        if (err) {
            logger.error(`Failed to decline offer ${offer.id}: ${err.message}`);
            errorCounter.inc();
            sendDiscordMessage(`❌ Failed to decline offer ${offer.id}: ${err.message}. Please decline manually.`);
        } else {
            logger.info(`Offer ${offer.id} declined by bot`);
        }
    });
}

const MAX_ACCEPT_ATTEMPTS = 3;
const MAX_CONFIRM_ATTEMPTS = 3;
const CONFIRM_RETRY_MS = 15000;

function confirmOffer(offer, attempt = 0) {
    community.acceptConfirmationForObject(identitySecret, offer.id, (err) => {
        if (!err) {
            logger.info(`Offer ${offer.id} confirmed via Steam Guard Mobile Authenticator`);
            logOffer(offer);
            return;
        }
        if (attempt + 1 < MAX_CONFIRM_ATTEMPTS) {
            logger.warn(`Failed to confirm offer ${offer.id} (attempt ${attempt + 1}/${MAX_CONFIRM_ATTEMPTS}): ${err.message}. Retrying`);
            setTimeout(() => confirmOffer(offer, attempt + 1), CONFIRM_RETRY_MS);
            return;
        }
        // Reservation stays. You can still confirm the offer manually.
        logger.error(`Failed to confirm offer ${offer.id} after ${MAX_CONFIRM_ATTEMPTS} attempts: ${err.message}`);
        errorCounter.inc();
        sendDiscordMessage(`❌ Failed to confirm offer ${offer.id} after ${MAX_CONFIRM_ATTEMPTS} attempts: ${err.message}. Please confirm manually.`);
    });
}

function acceptOffer(offer, attempt = 0) {
    offer.accept((err, status) => {
        if (!err && status !== 'pending') {
            // Bot gives nothing: Steam needs no mobile confirmation.
            logger.info(`Offer ${offer.id} accepted by bot (no confirmation needed)`);
            logOffer(offer);
        } else if (!err) {
            logger.info(`Offer ${offer.id} accepted by bot (awaiting Mobile confirmation)`);
            confirmOffer(offer);
        } else if (err.message === "Not Logged In") {
            if (attempt >= MAX_ACCEPT_ATTEMPTS) {
                logger.error(`Failed to accept offer ${offer.id} after ${MAX_ACCEPT_ATTEMPTS} attempts`);
                sendDiscordMessage(`❌ Failed to accept offer ${offer.id} after ${MAX_ACCEPT_ATTEMPTS} session retries.`);
                reservations.release(offer.id);
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
            reservations.release(offer.id);
        }
    });
}

// ---- Functions for the web UI (via bot.js) ----

function getSteamOffer(id) {
    return new Promise((resolve, reject) => {
        manager.getOffer(String(id), (err, offer) => (err ? reject(err) : resolve(offer)));
    });
}

// Only active offers that the partner sent to the bot can be accepted or declined.
async function getActiveReceivedOffer(id) {
    const offer = await getSteamOffer(id);
    if (offer.isOurOffer) throw new Error('Offer was sent by the bot');
    if (offer.state !== TradeOfferManager.ETradeOfferState.Active) {
        throw new Error(`Offer is not active (${TradeOfferManager.ETradeOfferState[offer.state]})`);
    }
    return offer;
}

// Active offers the bot received. Joined with the stored check result.
function getOpenOffers() {
    return new Promise((resolve, reject) => {
        manager.getOffers(TradeOfferManager.EOfferFilter.ActiveOnly, null, (err, sent, received) => {
            if (err) return reject(err);
            const S = TradeOfferManager.ETradeOfferState;
            resolve(received.filter(o => o.state === S.Active).map(steamOffer => {
                const offer = mapSteamOffer(steamOffer);
                const stored = getTrade(steamOffer.id);
                return {
                    trade_id: String(steamOffer.id),
                    timestamp: steamOffer.created ? steamOffer.created.getTime() : null,
                    partner_id: steamOffer.partner.getSteamID64(),
                    partner_name: stored?.partner_name || null,
                    items_to_receive: offer.itemsToReceive,
                    items_to_give: offer.itemsToGive,
                    // null = bot has not checked this offer (e.g. it came in before this version)
                    checked: !!stored,
                    accepted: stored ? stored.accepted : null,
                    reason: stored?.reason || null,
                    reason_codes: stored?.reason_codes || [],
                    manual_action: stored?.manual_action || null,
                    reserved: reservations.has(steamOffer.id),
                };
            }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
        });
    });
}

// Manual accept from the web UI. The rules are not checked again: you decided.
// Protected cards are reserved, so parallel offers count them as gone.
async function manualAcceptOffer(id) {
    const steamOffer = await getActiveReceivedOffer(id);
    const softGiveIds = getTradeRules().setRules.duplicatesOnly;
    const softGiveItems = mapSteamOffer(steamOffer).itemsToGive.filter(item => softGiveIds.includes(item.appId));
    if (softGiveItems.length > 0) {
        await runExclusive(async () => reservations.reserve(steamOffer.id, softGiveItems));
    }
    setManualAction(steamOffer.id, 'accepted');
    logger.info(`Offer ${steamOffer.id} accepted manually via web UI`);
    sendDiscordMessage(`🖐️ Offer ${steamOffer.id} accepted manually via web UI.`);
    // Result (confirmation, errors) goes to log and Discord like a normal accept.
    acceptOffer(steamOffer);
}

async function manualDeclineOffer(id) {
    const steamOffer = await getActiveReceivedOffer(id);
    await new Promise((resolve, reject) => steamOffer.decline(err => (err ? reject(err) : resolve())));
    reservations.release(steamOffer.id);
    setManualAction(steamOffer.id, 'declined');
    logger.info(`Offer ${steamOffer.id} declined manually via web UI`);
    sendDiscordMessage(`🖐️ Offer ${steamOffer.id} declined manually via web UI.`);
}

// Cards of the bot grouped by set. Short cache: the web UI can reload often.
const INVENTORY_CACHE_MS = 60 * 1000;
let inventoryCache = null;

async function getInventorySets({ refresh = false } = {}) {
    if (refresh || !inventoryCache || inventoryCache.expiresAt < Date.now()) {
        inventoryCache = { items: await loadCardInventory(), loadedAt: Date.now(), expiresAt: Date.now() + INVENTORY_CACHE_MS };
    }
    const rules = getTradeRules();
    const sets = groupCardsBySet(inventoryCache.items, { neverGive: rules.setRules.neverGiveIds(), duplicatesOnly: rules.setRules.duplicatesOnly });
    const sizes = getSetSizes([...new Set(sets.map(s => s.appId))]);
    sets.forEach(set => { set.setSize = sizes.get(set.appId) ?? null; });
    return { loadedAt: inventoryCache.loadedAt, sets };
}

// Set size from the badge page of the bot. Normal and foil sets have the same size.
// Cached in the DB, because it does not change and the page is slow.
async function loadSetSize(appId) {
    const cached = getSetSizes([appId]).get(String(appId));
    if (cached) return cached;
    if (!steamClient.steamID) throw new Error('Bot is not logged in');
    const url = `https://steamcommunity.com/profiles/${steamClient.steamID.getSteamID64()}/gamecards/${encodeURIComponent(appId)}/`;
    const html = await new Promise((resolve, reject) => {
        community.httpRequestGet(url, (err, response, body) => (err ? reject(err) : resolve(body)));
    });
    const size = parseSetSize(html);
    if (!size) throw new Error('Set size not found on badge page');
    saveSetSize(appId, size);
    return size;
}

bot.register({ getOpenOffers, manualAcceptOffer, manualDeclineOffer, getInventorySets, loadSetSize });
