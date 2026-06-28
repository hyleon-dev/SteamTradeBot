const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const SteamCommunity = require("steamcommunity");
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamID = require('steamid');
const config = require('./config.json');
const logger = require('./logger');
const { logOffer, logMessage } = require('./db');
const { errorCounter, reconnectCounter } = require('./metrics');
const { discordMessageBuilder, sendDiscordMessage } = require('./discord');

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
const interval = 60;
const heartbeat = async () => {
    await fetch(pushURL);
};
heartbeat();
setInterval(heartbeat, interval * 1000);

// Config
const saleMarketFeeAppIdGive = Array.from(config.sale_market_fee_app_id_give).flatMap(id => String(id));
const saleMarketFeeAppIdGet = config.sale_market_fee_app_id_get;
const hardBlacklist = { get: any = Array.from(config.do_not_get_hard).flatMap(id => String(id)), give: any = Array.from(config.do_not_give_hard).flatMap(id => String(id)) };
const softBlacklist = { get: any = Array.from(config.do_not_get_soft).flatMap(id => String(id)), give: any = Array.from(config.do_not_give_soft).flatMap(id => String(id)) };

let wasConnected = false;

let itemsToReceive
let itemsToGive

let saleCardsToGiveValid = true;
let includesHardBlacklisted = false;
let includesSoftBlacklisted = false;

// Disables asking for Steam Guard Code
steamClient.setOption("promptSteamGuardCode", false);

steamClient.logOn(loginDetails);

// Log in
steamClient.on('loggedOn', () => {
    logger.info(`Logged into Steam`);
    sendDiscordMessage("🤖 Beep boop! I'm alive!")
    steamClient.setPersona(SteamUser.EPersonaState.Online);
});

steamClient.on("error", function (e) {
    logger.error(`Steam client error: ${e}`);
    errorCounter.inc(); // Fehler zählen

    // Nur bei kritischen Fehlern beenden
    if (e.message.includes("Invalid Password") || e.message.includes("Invalid Auth Code")) {
        process.exit(1);
    }
    // Bei anderen Fehlern Reconnect versuchen
    setTimeout(() => {
        reconnectCounter.inc(); // Reconnect-Versuche zählen
        steamClient.logOn(loginDetails);
    }, 60000); // 1 Minute warten
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
        // Kurz warten und dann neu anmelden
        setTimeout(() => {
            reconnectCounter.inc();
            steamClient.logOn(loginDetails);
        }, 5000); // 5 Sekunden warten
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

// Arrays nach Verarbeitung leeren
function cleanupTradeData() {
    itemsToReceive = [];
    itemsToGive = [];
    includesHardBlacklisted = false;
    includesSoftBlacklisted = false;
    saleCardsToGiveValid = true;
    discordMessageBuilder.length = 0;
}

manager.on('newOffer', async function (offer) {

    const partnerSteamId = SteamID.fromIndividualAccountID(offer.partner.accountid);
    let tradePartner = await loadUserFromAccountId(partnerSteamId.getSteamID64());

    logger.info(`Start of offer validation for ${offer.id} from ${tradePartner.personaname} (${tradePartner.steamid})`)
    discordMessageBuilder.push(`🆕 Offer from ${tradePartner.personaname} received.`);
    discordMessageBuilder.push('\n')

    itemsToReceive = Array.from(offer.itemsToReceive);
    itemsToGive = Array.from(offer.itemsToGive);
    saleCardsToGiveValid = true;

    discordMessageBuilder.push(`➡️ The Bot will receive ${itemsToReceive.length} cards`)
    discordMessageBuilder.push(`⬅️ The Bot will give ${itemsToGive.length} cards`)
    discordMessageBuilder.push('\n')

    logger.debug(`ItemsToReceive: (${itemsToReceive.length}) ${itemsToText(itemsToReceive)}`)
    logger.debug(`ItemsToGive: (${itemsToGive.length}) ${itemsToText(itemsToGive)}`)

    // check if offer only contains trading cards
    let itemsToReceiveAreTradingCards = offer.itemsToReceive.every(item => {
        return item.tags.find(tag => tag.name === "Trading Card") != null
    });
    logger.debug(`All received items are trading cards: ${itemsToReceiveAreTradingCards}`)

    let itemsToGiveAreTradingCards = offer.itemsToGive.every(item => {
        return item.tags.find(tag => tag.name === "Trading Card") != null
    });
    logger.debug(`All given items are trading cards: ${itemsToGiveAreTradingCards}`)

    if (!itemsToReceiveAreTradingCards || !itemsToGiveAreTradingCards) return

    const itemsToGiveMap = new Map();
    const itemsToReceiveMap = new Map();

    // put items to give in Map
    // hard blacklisting: every trade with these games will not be accepted automatically
    itemsToGive.forEach(itemToGive => {
        if (!hardBlacklist.give.includes(itemToGive.market_fee_app)) {
            const appAndBorder = itemToGive.market_fee_app + "_" + itemToGive.tags.find(tag => tag.category === "cardborder").name;
            if (itemsToGiveMap.has(appAndBorder)) {
                itemsToGiveMap.get(appAndBorder).push(itemToGive);
            } else {
                itemsToGiveMap.set(appAndBorder, [itemToGive]);
            }
        } else {
            includesHardBlacklisted = true;
            logger.warn(`Hard blacklisted game to give found: ${itemToGive.market_fee_app}`);
        }
    })

    // put items to receive in Map
    itemsToReceive.forEach(itemToReceive => {
        if (!hardBlacklist.get.includes(itemToReceive.market_fee_app)) {
            const appAndBorder = itemToReceive.market_fee_app + "_" + itemToReceive.tags.find(tag => tag.category === "cardborder").name;
            if (itemsToReceiveMap.has(appAndBorder)) {
                itemsToReceiveMap.get(appAndBorder).push(itemToReceive);
            } else {
                itemsToReceiveMap.set(appAndBorder, [itemToReceive]);
            }
        } else {
            includesHardBlacklisted = true;
            logger.warn(`Hard blacklisted game to get found: ${itemToReceive.market_fee_app}`);
        }
    });

    logger.debug(`Trade includes hard blacklisted items: ${includesHardBlacklisted}`)
    discordMessageBuilder.push('↔️ Following trades will be made:')

    // sorting out 1:1 trades
    itemsToGiveMap.forEach((items, key) => {
        if (itemsToReceiveMap.has(key) && items.length === itemsToReceiveMap.get(key).length) {
            logger.info(`Found 1:1 trade for game ${key}`);

            for (let i = 0; i < items.length; i++) {
                discordMessageBuilder.push(`➡️ ${itemsToReceiveMap.get(key)[i].name} (${trimItemType(items[i].type)}) \n⬅️ ${items[i].name} (${trimItemType(items[i].type)}) \n`);
            }

            itemsToReceiveMap.delete(key);
            itemsToGiveMap.delete(key);

        } else if (itemsToReceiveMap.has(key) && items.length < itemsToReceiveMap.get(key).length) {
            logger.info(`Found more items for game ${key} (${items.length} items to give and ${itemsToReceiveMap.get(key).length} items to receive)`);

            // for every given item, one item to get is removed
            const popedItems = [];
            for (let i = 1; i <= items.length; i++) {
                const popedItem = itemsToReceiveMap.get(key).pop();
                if (popedItem !== undefined) popedItems.push(popedItem);
            }

            for (let i = 0; i < popedItems.length; i++) {
                discordMessageBuilder.push(`➡️ ${popedItems[i].name} (${trimItemType(popedItems.type)}) \n⬅️ ${itemsToGiveMap.get(key)[i].name} (${trimItemType(itemsToGiveMap.get(key)[i].type)}) \n`);
            }
            itemsToGiveMap.delete(key);
        }
    })

    // soft blacklisting: X:X trading is accepted automatically, X:(X*2) trading is not
    itemsToGive = [];
    itemsToGiveMap.forEach(items => {
            items.forEach(item => {
                if (!softBlacklist.give.includes(item.market_fee_app)) {
                itemsToGive.push(item);
                } else {
                    includesSoftBlacklisted = true;
                    logger.warn(`Soft blacklisted game to give found: ${item.market_fee_app}`);
                }
            });
    });

    itemsToReceive = [];
    itemsToReceiveMap.forEach(items => {
        items.forEach(item => {
            if (!softBlacklist.get.includes(item.market_fee_app)) {
                itemsToReceive.push(item);
            } else {
                includesSoftBlacklisted = true;
                logger.warn(`Soft blacklisted game to get found: ${item.market_fee_app}`);
            }
        });
    });

    logger.debug(`Trade includes soft blacklisted items: ${includesSoftBlacklisted}`)

    // removes cards for special sale cards condition
    logger.debug(`SaleMarketFeeAppIdGet: ${saleMarketFeeAppIdGet}`)
    if (saleMarketFeeAppIdGet !== undefined && saleMarketFeeAppIdGet !== null && saleMarketFeeAppIdGet !== "") {

        itemsToReceive.forEach(item => {
            const itemIsSaleItem = item.market_fee_app === saleMarketFeeAppIdGet
            logger.debug(`Checking sale item to receive: ${item.market_name} — is sale item: ${itemIsSaleItem}`)
            if (itemIsSaleItem) {
                specialCardGet(item, offer);
            }
        })

        itemsToGive.forEach(item => {
            const itemIsSaleItem = saleMarketFeeAppIdGive.filter(id => id === item.market_fee_app).length >> 0 && saleCardsToGiveValid
            logger.debug(`Checking sale item to give: ${item.market_name} — is sale item: ${itemIsSaleItem}`)
            if (itemIsSaleItem) {
                specialCardGive(item, offer);
            }
        })
    }

    //checks cross set cards: X of my cards for X*2 or more cards of the trade partner (2:4 = ok; 2:5 = ok; 2:3 = not ok)
    const normalCardsToGive = itemsToGive.filter(item =>
        item.tags.find(tag => tag.category === "cardborder")
            .internal_name === "cardborder_0").length;

    const normalCardsToReceive = itemsToReceive.filter(item =>
        item.tags.find(tag => tag.category === "cardborder")
            .internal_name === "cardborder_0").length;

    const foilCardsToGive = itemsToGive.filter(item =>
        item.tags.find(tag => tag.category === "cardborder")
            .internal_name === "cardborder_1").length;

    const foilCardsToReceive = itemsToReceive.filter(item =>
        item.tags.find(tag => tag.category === "cardborder")
            .internal_name === "cardborder_1").length

    logger.debug(`Cards to give after filtering: ${itemsToText(itemsToGive)}`)
    logger.debug(`Cards to receive after filtering: ${itemsToText(itemsToReceive)}`)

    logger.info(`${normalCardsToGive} cards to give and ${normalCardsToReceive} cards to receive left.`);
    logger.info(`${foilCardsToGive} foil cards to give and ${foilCardsToReceive} foil cards to receive left.`);

    var crossSetItemCountValid = (normalCardsToGive !== undefined && normalCardsToGive * 2 <= normalCardsToReceive)
        && (foilCardsToGive !== undefined && foilCardsToGive * 2 <= foilCardsToReceive);
    logger.debug(`Cross-set item ratio valid: ${crossSetItemCountValid} (normal: ${normalCardsToGive}:${normalCardsToReceive}, foil: ${foilCardsToGive}:${foilCardsToReceive})`);

    if (crossSetItemCountValid) {
        for (let i = 0; i < itemsToGive.length; i++) {
            discordMessageBuilder.push(`➡️ ${itemsToReceive[(i * 2)].name} (${trimItemType(itemsToReceive[(i * 2)].type)}) \n➡️ ${itemsToReceive[(i * 2) + 1].name} (${trimItemType(itemsToReceive[(i * 2) + 1].type)}) \n⬅️ ${itemsToGive[i].name} (${trimItemType(itemsToGive[i].type)}) \n`);
        }
    }

    const tradeAcceptCondition = itemsToReceiveAreTradingCards && (itemsToGiveAreTradingCards || itemsToGive.length === 0) && (crossSetItemCountValid || itemsToGive.length === 0) && saleCardsToGiveValid && !includesHardBlacklisted && !includesSoftBlacklisted;
    logger.debug(`Trade will be accepted: ${tradeAcceptCondition}`);
    if (tradeAcceptCondition) {
        discordMessageBuilder.push('✅ Trade will be accepted!');
        acceptOffer(offer);
    } else {
        logger.warn(`Can't validate offer ${offer.id}, please check manually`);
        discordMessageBuilder.push('❌ Trade will not be accepted! Please check manually.');

        if (!itemsToReceiveAreTradingCards || (!itemsToGiveAreTradingCards && itemsToGive > 0)) discordMessageBuilder.push('🔴 Found something other then trading card in trade.');
        if (!crossSetItemCountValid) discordMessageBuilder.push('🔴 Cross trading does not add up');
        if (!saleCardsToGiveValid) discordMessageBuilder.push('🔴 Found error within sale card trading');
        if (includesHardBlacklisted) discordMessageBuilder.push('🔴 Trade contains hard blacklisted game');
        if (includesSoftBlacklisted) discordMessageBuilder.push('🔴 Cross trading contains soft blacklisted game');
    }
    sendDiscordMessage(discordMessageBuilder.join('\n'));
    logger.info(`End of offer validation for ${offer.id}`);
    cleanupTradeData();
});

function acceptOffer(offer) {
    offer.accept((err, status) => {
        if (err && err.message !== "Not Logged In") {
            logger.error(err);
        } else if (err && err.message === "Not Logged In") {
            // if session is expired and error has been thrown
            reconnectCounter.inc(); // Reconnect nach Session-Timeout zählen

            logger.warn(`Session timed out, re-logging in`)
            // first log properly off
            steamClient.logOff()
            // second login again
            steamClient.logOn(loginDetails);

            // wait for authentication (31 seconds for new auth code + 9 seconds buffer) and try again to accept offer
            setTimeout(() => {
                acceptOffer(offer);
            }, 40000);

        } else {

            logger.info(`Offer ${offer.id} accepted by bot (awaiting Mobile confirmation)`);
            community.acceptConfirmationForObject(identitySecret, offer.id, (err, status) => {
                if (err) {
                    logger.error(`Failed to confirm offer ${offer.id}: ${err}`)
                } else {
                    logger.info(`Offer ${offer.id} confirmed via Steam Guard Mobile Authenticator`);
                    logOffer(offer);
                }
            });
        }
    });
}

function specialCardGet(itemToGet, offer) {

    let itemsToGiveOfGameInTrade = itemsToGive.filter(item =>
        item.market_fee_app !== itemToGet.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGet.tags.find(tag => tag.category === "cardborder").internal_name);
    logger.debug(`ItemsToGiveOfGameInTrade: (${itemsToGiveOfGameInTrade.length}) ${itemsToText(itemsToGiveOfGameInTrade)}`)

    let itemsToReceiveOfGameInTrade = itemsToReceive.filter(item =>
        item.market_fee_app === itemToGet.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGet.tags.find(tag => tag.category === "cardborder").internal_name);
    logger.debug(`ItemsToReceiveOfGameInTrade: (${itemsToReceiveOfGameInTrade.length}) ${itemsToText(itemsToReceiveOfGameInTrade)}`)

    // get 1 special card, give 2 non-special cards
    const conditionsToGiveSpecialCard = (itemsToReceiveOfGameInTrade.length >= 1 && itemsToGiveOfGameInTrade.length >= 2) && itemsToGiveOfGameInTrade.length <= itemsToReceiveOfGameInTrade.length * 2;
    logger.debug(`ConditionsToGiveSpecialCard: ${conditionsToGiveSpecialCard}`)
    if (conditionsToGiveSpecialCard) {
        for (var i = 0; i < itemsToReceiveOfGameInTrade.length * 2; i++) {
            itemsToGive.splice(itemsToGive.indexOf(itemsToGiveOfGameInTrade.at(i)), 1)
            logger.debug(`Excluded from trade (sale card rule): ${itemsToGiveOfGameInTrade.at(i).market_name} (${itemsToGiveOfGameInTrade.at(i).type})`)
        }
        for (var j = 0; j < itemsToReceiveOfGameInTrade.length; j++) {
            itemsToReceive.splice(itemsToReceive.indexOf(itemsToReceiveOfGameInTrade.at(j)), 1)
            logger.debug(`Excluded from trade (sale card rule): ${itemsToReceiveOfGameInTrade.at(j).market_name} (${itemsToReceiveOfGameInTrade.at(j).type})`)
        }
        logger.info(`${i} sale cards to give and ${j} sale cards to receive excluded from trade`)
    }
}

function specialCardGive(itemToGive, offer) {

    let itemsToGiveOfGameInTrade = itemsToGive.filter(item =>
        item.market_fee_app === itemToGive.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGive.tags.find(tag => tag.category === "cardborder").internal_name);
    logger.debug(`ItemsToGiveOfGameInTrade: (${itemsToGiveOfGameInTrade.length}) ${itemsToText(itemsToGiveOfGameInTrade)}`)

    let itemsToReceiveOfGameInTrade = itemsToReceive.filter(item =>
        item.market_fee_app !== itemToGive.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGive.tags.find(tag => tag.category === "cardborder").internal_name);
    logger.debug(`ItemsToReceiveOfGameInTrade: (${itemsToReceiveOfGameInTrade.length}) ${itemsToText(itemsToReceiveOfGameInTrade)}`)

    // give 1 special card, receive 3 non-special cards
    const conditionsToGiveSpecialCard = (itemsToReceiveOfGameInTrade.length >= 3 && itemsToGiveOfGameInTrade.length >= 1) && itemsToGiveOfGameInTrade.length * 3 <= itemsToReceiveOfGameInTrade.length;
    logger.debug(`ConditionsToGiveSpecialCard: ${conditionsToGiveSpecialCard}`)
    if (conditionsToGiveSpecialCard) {
        for (var i = 0; i < itemsToGiveOfGameInTrade.length; i++) {
            itemsToGive.splice(itemsToGive.indexOf(itemsToGiveOfGameInTrade.at(i)), 1)
            logger.debug(`Excluded from trade (sale card rule): ${itemsToGiveOfGameInTrade.at(i).market_name} (${itemsToGiveOfGameInTrade.at(i).type})`)
        }
        for (var j = 0; j < itemsToGiveOfGameInTrade.length * 3; j++) {
            itemsToReceive.splice(itemsToReceive.indexOf(itemsToReceiveOfGameInTrade.at(j)), 1)
            logger.debug(`Excluded from trade (sale card rule): ${itemsToReceiveOfGameInTrade.at(j).market_name} (${itemsToReceiveOfGameInTrade.at(j).type})`)
        }
        logger.info(`${i} sale cards to give and ${j} sale cards to receive excluded from trade`)
    } else {
        saleCardsToGiveValid = false;
    }
}

function itemsToText(items) {
    return `[${items.map(item => `'${item.market_name} (${item.type})'`)}]`;
}

function trimItemType(type) {
    return type.replaceAll(" Foil").replaceAll(" Trading Card", "");
}

async function loadUserFromAccountId(steamId) {
    return (await (await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${config.steam_api_key}&steamids=${steamId}`)).json())
        .response
        .players[0];
}
