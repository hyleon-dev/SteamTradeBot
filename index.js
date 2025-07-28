const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const SteamCommunity = require("steamcommunity");
const TradeOfferManager = require('steam-tradeoffer-manager');
const IO = require('@pm2/io')

const config = require('./config.json');

const client = new SteamUser();
const community = new SteamCommunity();
const manager = new TradeOfferManager({
    "steam": client,
    "community": community,
    "language": "en"
});

const loginDetails = {
    accountName: config.username,
    password: config.password,
    logonID: Math.floor(Math.random() * 1000) + 1
};

const metricsReconnects = IO.counter({
    name: 'Reconnects',
    id: 'app/stb/reconnects'
});

const metricsErrors = IO.counter({
    name: 'Errors',
    id: 'app/stb/errors'
});

const trades = IO.counter({
    name: 'Trades',
    id: 'app/stb/trades'
})

const cardsReceived = IO.counter({
    name: 'Cards Received',
    id: 'app/stb/cards/received'
})

const cardsGiven = IO.counter({
    name: 'Card Given',
    id: 'app/stb/cards/given'
})

const logAuthPrefix = "****"
const logTradeValidationStepsPrefix = "===="
const logTradeValidationResultPrefix = "####"
const logDebugPrefix = "[DEBUG]"

const identitySecret = config.identity_secret;
const saleMarketFeeAppIdGive = Array.from(config.sale_market_fee_app_id_give).flatMap(id => String(id));
const saleMarketFeeAppIdGet = config.sale_market_fee_app_id_get;
const blacklisted = { get: any = Array.from(config.do_not_get).flatMap(id => String(id)), give: any = Array.from(config.do_not_give).flatMap(id => String(id)) };

let wasConnected = false;

let itemsToReceive
let itemsToGive

let saleCardsToGiveValid = true;
let includesBlacklisted = false;

// Disables asking for Steam Guard Code
client.setOption("promptSteamGuardCode", false);

client.logOn(loginDetails);

// Log in
client.on('loggedOn', () => {
    console.log(`${logAuthPrefix} Logged into Steam!`);
    client.setPersona(SteamUser.EPersonaState.Online);
});

client.on("error", function (e) {
    console.log(`${logAuthPrefix} Fehler aufgetreten: ${e}`);
    metricsErrors.inc(); // Fehler zählen

    // Nur bei kritischen Fehlern beenden
    if (e.message.includes("Invalid Password") || e.message.includes("Invalid Auth Code")) {
        process.exit(1);
    }
    // Bei anderen Fehlern Reconnect versuchen
    setTimeout(() => {
        metricsReconnects.inc(); // Reconnect-Versuche zählen
        client.logOn(loginDetails);
    }, 60000); // 1 Minute warten
});

/*setInterval(() => {
    if (!client.connected) {
        console.log("Verbindung verloren - versuche Reconnect");
        client.logOn(loginDetails);
    }
}, 300000); // Alle 5 Minuten*/

// If last Steam Guard Code was wrong, here a new one is created
client.on("steamGuard", function (domain, callback, lastCodeWrong) {
    if (lastCodeWrong) {
        console.log(`${logAuthPrefix} Last code wrong, try again!`);
    } else {
        console.log(`${logAuthPrefix} Authorized with Steam Guard Code.`)
    }
    setTimeout(function () {
        callback(SteamTotp.generateAuthCode(config.shared_secret));
    }, 31000);
});

client.on('webSession', (sessionid, cookies) => {
    manager.setCookies(cookies);
    community.setCookies(cookies);
});

client.on('connected', () => {
    wasConnected = true;
    console.log(`${logAuthPrefix} Verbindung hergestellt`);

});

client.on('disconnected', () => {
    if (wasConnected) {
        console.log(`${logAuthPrefix} Verbindung verloren - versuche Reconnect`);
        // Kurz warten und dann neu anmelden
        setTimeout(() => {
            metricsReconnects.inc();
            client.logOn(loginDetails);
        }, 5000); // 5 Sekunden warten
    }
    wasConnected = false;
});

// Arrays nach Verarbeitung leeren
function cleanupTradeData() {
    itemsToReceive = [];
    itemsToGive = [];
}

manager.on('newOffer', function (offer) {

    /*community.getNotifications((err, notifications) => {
        if (err) {
            console.log(err)
        } else {
            console.log(notifications)
            console.log(notifications.trades);
        }
    })*/

    console.log(`${logTradeValidationStepsPrefix} start of offer validation for ${offer.id}`)

    itemsToReceive = Array.from(offer.itemsToReceive);
    itemsToGive = Array.from(offer.itemsToGive);
    saleCardsToGiveValid = true;

    console.debug(`${logDebugPrefix} itemsToReceive: (${itemsToReceive.length}) ${itemsToText(itemsToReceive)}`)
    console.debug(`${logDebugPrefix} itemsToGive: (${itemsToGive.length}) ${itemsToText(itemsToGive)}`)

    // check if offer only contains trading cards
    let itemsToReceiveAreTradingCards = offer.itemsToReceive.every(item => {
        return item.tags.find(tag => tag.name === "Trading Card") != null
    });
    console.debug(`${logDebugPrefix} itemsToReceiveAreTradingCards: ${itemsToReceiveAreTradingCards}`)

    let itemsToGiveAreTradingCards = offer.itemsToGive.every(item => {
        return item.tags.find(tag => tag.name === "Trading Card") != null
    });
    console.debug(`${logDebugPrefix} itemsToGiveAreTradingCards: ${itemsToGiveAreTradingCards}`)

    if (!itemsToReceiveAreTradingCards || !itemsToGiveAreTradingCards) return

    const itemsToGiveMap = new Map();
    const itemsToReceiveMap = new Map();

    // put items to give in Map
    itemsToGive.forEach(itemToGive => {
        if (blacklisted.give.includes(itemToGive.market_fee_app)) includesBlacklisted = true; // this solutions is to keep 'includesBlacklisted' on true
        const appAndBorder = itemToGive.market_fee_app + "_" + itemToGive.tags.find(tag => tag.category === "cardborder").name;
        if (itemsToGiveMap.has(appAndBorder)) {
            itemsToGiveMap.get(appAndBorder).push(itemToGive);
        } else {
            itemsToGiveMap.set(appAndBorder, [itemToGive]);
        }
    })

    // put items to receive in Map
    itemsToReceive.forEach(itemToReceive => {
        if (blacklisted.give.includes(itemToReceive.market_fee_app)) includesBlacklisted = true; // this solutions is to keep 'includesBlacklisted' on true
        const appAndBorder = itemToReceive.market_fee_app + "_" + itemToReceive.tags.find(tag => tag.category === "cardborder").name;
        if (itemsToReceiveMap.has(appAndBorder)) {
            itemsToReceiveMap.get(appAndBorder).push(itemToReceive);
        } else {
            itemsToReceiveMap.set(appAndBorder, [itemToReceive]);
        }
    });

    console.log(`${logTradeValidationStepsPrefix} Trade includes blacklisted games: ${includesBlacklisted}`)

    // sorting out 1:1 trades
    itemsToGiveMap.forEach((items, key) => {
        if (itemsToReceiveMap.has(key) && items.length === itemsToReceiveMap.get(key).length) {
            console.log(`${logTradeValidationStepsPrefix} found 1:1 trade for game ${key}`);
            itemsToReceiveMap.delete(key);
            itemsToGiveMap.delete(key);
        } else if (itemsToReceiveMap.has(key) && items.length < itemsToReceiveMap.get(key).length) {
            console.log(`${logTradeValidationStepsPrefix} found more items for game ${key} (${items.length} items to give and ${itemsToReceiveMap.get(key).length} items to receive)`);

            // for every given item, one item to get is removed
            for (let i = 1; i <= items.length; i++) {
                itemsToReceiveMap.get(key).pop();
            }
            itemsToGiveMap.delete(key);
        }
    })

    itemsToGive = [];
    itemsToGiveMap.forEach(items => {
        items.forEach(item => {
            itemsToGive.push(item);
        })
    });

    itemsToReceive = [];
    itemsToReceiveMap.forEach(items => {
        items.forEach(item => {
            itemsToReceive.push(item);
        })
    });

    // removes cards for special sale cards condition
    console.debug(`${logDebugPrefix} saleMarketFeeAppIdGet: ${saleMarketFeeAppIdGet}`)
    if (saleMarketFeeAppIdGet === undefined || saleMarketFeeAppIdGet === null || saleMarketFeeAppIdGet === "") return;

    console.debug(`${logDebugPrefix} itemsToReceive: (${itemsToReceive.length}) ${itemsToText(itemsToReceive)}`)
    itemsToReceive.forEach(item => {
        console.debug(`${logDebugPrefix} item: ${item.market_name} (${item.type})`)

        const itemIsSaleItem = item.market_fee_app === saleMarketFeeAppIdGet
        console.debug(`${logDebugPrefix} itemIsSaleItem: ${itemIsSaleItem}`)
        if (itemIsSaleItem) {
            specialCardGet(item, offer);
        }
    })

    console.debug(`${logDebugPrefix} saleMarketFeeAppIdGive: ${saleMarketFeeAppIdGive}`)
    itemsToGive.forEach(item => {
        console.debug(`${logDebugPrefix} item: ${item}`)

        const itemIsSaleItem = saleMarketFeeAppIdGive.filter(id => id === item.market_fee_app).length >> 0 && saleCardsToGiveValid
        console.debug(`${logDebugPrefix} itemIsSaleItem: ${itemIsSaleItem}`)
        if (itemIsSaleItem) {
            specialCardGive(item, offer);
        }
    })

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


    itemsToGive.forEach(item => {
        console.log(`Card to give left: ${item.market_name} (${item.type})`)
    })

    itemsToReceive.forEach(item => {
        console.log(`Card to receive left: ${item.market_name} (${item.type})`)
    })

    console.log(`${normalCardsToGive} cards to give and ${normalCardsToReceive} cards to receive left.`);
    console.log(`${foilCardsToGive} foil cards to give and ${foilCardsToReceive} foil cards to receive left.`);

    var crossSetItemCountValid = (normalCardsToGive !== undefined && normalCardsToGive * 2 <= normalCardsToReceive)
        && (foilCardsToGive !== undefined && foilCardsToGive * 2 <= foilCardsToReceive);
    console.debug(`${logDebugPrefix} crossSetItemCountValid: ${crossSetItemCountValid}`)

    const tradeAcceptCondition = itemsToReceiveAreTradingCards && (itemsToGiveAreTradingCards || itemsToGive.length === 0) && (crossSetItemCountValid || itemsToGive.length === 0) && saleCardsToGiveValid && !includesBlacklisted;
    console.debug(`${logDebugPrefix} tradeAcceptCondition: ${tradeAcceptCondition}`)
    if (tradeAcceptCondition) {
        acceptOffer(offer)
    } else {
        console.log(`${logTradeValidationResultPrefix} Can't validate offer ${offer.id}, please check manually`)
    }
    console.log(`${logTradeValidationStepsPrefix} end of offer validation for ${offer.id}`)
    cleanupTradeData();
});

function acceptOffer(offer) {
    offer.accept((err, status) => {
        if (err && err.message !== "Not Logged In") {
            console.log(err);
        } else if (err && err.message === "Not Logged In") {
            // if session is expired and error has been thrown
            metricsReconnects.inc(); // Reconnect nach Session-Timeout zählen

            console.log(`${logAuthPrefix} Session timed out. Re-login`)
            // first log properly off
            client.logOff()
            // second login again
            client.logOn(loginDetails);

            // wait for authentication (31 seconds for new auth code + 9 seconds buffer) and try again to accept offer
            setTimeout(() => {
                acceptOffer(offer);
            }, 40000);

        } else {

            console.log(`${logTradeValidationResultPrefix} Accepted offer ${offer.id}.`);
            community.acceptConfirmationForObject(identitySecret, offer.id, (err, status) => {
                if (err) {
                    console.log(err)
                } else {
                    console.log(`${logTradeValidationResultPrefix} Confirmed offer ${offer.id}.`);
                    trades.inc();
                    cardsGiven.inc(offer.itemsToGive.length);
                    cardsReceived.inc(offer.itemsToReceive.length);
                }
            });
        }
    });
}

function specialCardGet(itemToGet, offer) {

    let itemsToGiveOfGameInTrade = itemsToGive.filter(item =>
        item.market_fee_app !== itemToGet.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGet.tags.find(tag => tag.category === "cardborder").internal_name);
    console.debug(`${logDebugPrefix} itemsToGiveOfGameInTrade: (${itemsToGiveOfGameInTrade.length}) ${itemsToText(itemsToGiveOfGameInTrade)}`)

    let itemsToReceiveOfGameInTrade = itemsToReceive.filter(item =>
        item.market_fee_app === itemToGet.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGet.tags.find(tag => tag.category === "cardborder").internal_name);
    console.debug(`${logDebugPrefix} itemsToReceiveOfGameInTrade: (${itemsToReceiveOfGameInTrade.length}) ${itemsToText(itemsToReceiveOfGameInTrade)}`)

    // get 1 special card, give 2 non-special cards
    const conditionsToGiveSpecialCard = (itemsToReceiveOfGameInTrade.length >= 1 && itemsToGiveOfGameInTrade.length >= 2) && itemsToGiveOfGameInTrade.length <= itemsToReceiveOfGameInTrade.length * 2;
    console.debug(`${logDebugPrefix} conditionsToGiveSpecialCard: ${conditionsToGiveSpecialCard}`)
    if (conditionsToGiveSpecialCard) {
        for (var i = 0; i < itemsToReceiveOfGameInTrade.length * 2; i++) {
            itemsToGive.splice(itemsToGive.indexOf(itemsToGiveOfGameInTrade.at(i)), 1)
            console.log(`Sorted card to give out: ${itemsToGiveOfGameInTrade.at(i).market_name} (${itemsToGiveOfGameInTrade.at(i).type})`)
        }
        for (var j = 0; j < itemsToReceiveOfGameInTrade.length; j++) {
            itemsToReceive.splice(itemsToReceive.indexOf(itemsToReceiveOfGameInTrade.at(j)), 1)
            console.log(`Sorted card to receive out: ${itemsToReceiveOfGameInTrade.at(j).market_name} (${itemsToReceiveOfGameInTrade.at(j).type})`)
        }
        console.log(`${i} sale cards to give and ${j} sale cards to receive sorted out.`)
        console.log(`${logTradeValidationStepsPrefix}`)
    }
}

function specialCardGive(itemToGive, offer) {

    let itemsToGiveOfGameInTrade = itemsToGive.filter(item =>
        item.market_fee_app === itemToGive.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGive.tags.find(tag => tag.category === "cardborder").internal_name);
    console.debug(`${logDebugPrefix} itemsToGiveOfGameInTrade: (${itemsToGiveOfGameInTrade.length}) ${itemsToText(itemsToGiveOfGameInTrade)}`)

    let itemsToReceiveOfGameInTrade = itemsToReceive.filter(item =>
        item.market_fee_app !== itemToGive.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGive.tags.find(tag => tag.category === "cardborder").internal_name);
    console.debug(`${logDebugPrefix} itemsToReceiveOfGameInTrade: (${itemsToReceiveOfGameInTrade.length}) ${itemsToText(itemsToReceiveOfGameInTrade)}`)

    // give 1 special card, receive 3 non-special cards
    const conditionsToGiveSpecialCard = (itemsToReceiveOfGameInTrade.length >= 3 && itemsToGiveOfGameInTrade.length >= 1) && itemsToGiveOfGameInTrade.length * 3 <= itemsToReceiveOfGameInTrade.length;
    console.debug(`${logDebugPrefix} conditionsToGiveSpecialCard: ${conditionsToGiveSpecialCard}`)
    if (conditionsToGiveSpecialCard) {
        for (var i = 0; i < itemsToGiveOfGameInTrade.length; i++) {
            itemsToGive.splice(itemsToGive.indexOf(itemsToGiveOfGameInTrade.at(i)), 1)
            console.log(`Sorted card to give out: ${itemsToGiveOfGameInTrade.at(i).market_name} (${itemsToGiveOfGameInTrade.at(i).type})`)
        }
        for (var j = 0; j < itemsToGiveOfGameInTrade.length * 3; j++) {
            itemsToReceive.splice(itemsToReceive.indexOf(itemsToReceiveOfGameInTrade.at(j)), 1)
            console.log(`Sorted card to receive out: ${itemsToReceiveOfGameInTrade.at(j).market_name} (${itemsToReceiveOfGameInTrade.at(j).type})`)
        }
        console.log(`${i} sale cards to give and ${j} sale cards to receive sorted out.`)
        console.log(`${logTradeValidationStepsPrefix}`)
    } else {
        saleCardsToGiveValid = false;
    }
}

function itemsToText(items) {
    return `[${items.map(item => `'${item.market_name} (${item.type})'`)}]`;
}