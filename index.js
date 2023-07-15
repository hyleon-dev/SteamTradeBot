const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const SteamCommunity = require("steamcommunity");
const TradeOfferManager = require('steam-tradeoffer-manager');
const IO = require('@pm2/io')

const client = new SteamUser();
const community = new SteamCommunity();
const manager = new TradeOfferManager({
    "steam": client,
    "community": community,
    "language": "en"
});

const config = require('./config.json');

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

const friends = Array.from(config.friend_ids);
const identitySecret = config.identity_secret;
const saleMarketFeeAppIdGive = Array.from(config.sale_market_fee_app_id_give);
const saleMarketFeeAppIdGet = config.sale_market_fee_app_id_get;

const loginDetails = {
    accountName: config.username,
    password: config.password,
    logonID: Math.floor(Math.random() * 1000) + 1
};

var itemsToGet
var itemsToGive

var saleCardsToGiveValid = true;

// Disables asking for Steam Guard Code
client.setOption("promptSteamGuardCode", false);

client.logOn(loginDetails);

// Log in
client.on('loggedOn', () => {
    console.log(`${logAuthPrefix} Logged into Steam!`);
    client.setPersona(SteamUser.EPersonaState.Online);
});

// If some error occured during log in. Closes the process
client.on("error", function (e) {
    console.log(e);
    process.exit(1);
});

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

    let offerFromFriend = friends.find(acc => acc === offer.partner.getSteamID64()) != null;

    itemsToGet = Array.from(offer.itemsToReceive);
    itemsToGive = Array.from(offer.itemsToGive);
    saleCardsToGiveValid = true;

    console.debug(`itemsToGet: (${itemsToGet.length}) ${itemsToGet}`)
    console.debug(`itemsToGet: (${itemsToGive.length}) ${itemsToGive}`)

    // check if offer only contains trading cards
    let itemsToReceiveAreTradingCards = offer.itemsToReceive.every(item => {
        return item.tags.find(tag => tag.name === "Trading Card") != null
    });
    console.debug(`itemsToReceiveAreTradingCards: ${itemsToReceiveAreTradingCards}`)

    let itemsToGiveAreTradingCards = offer.itemsToGive.every(item => {
        return item.tags.find(tag => tag.name === "Trading Card") != null
    });
    console.debug(`itemsToGiveAreTradingCards: ${itemsToGiveAreTradingCards}`)

    /*itemsToGive.forEach(item => {
        var borderTag = item.tags.find(tag => tag.category === "cardborder");

        if (borderTag.internal_name === "cardborder_0") {
            //card is normal
        } else if (borderTag.internal_name === "cardborder_1") {
            //card is foil
        }
    })*/

    if (itemsToReceiveAreTradingCards && itemsToGiveAreTradingCards) {

        // removes valid 1:1 same set same border items from check list
        itemsToGive.forEach(itemToGive => {
            oneForOne(itemToGive, offer)
        })

        // removes cards for special sale cards condition
        console.debug(`saleMarketFeeAppIdGet: ${saleMarketFeeAppIdGet}`)
        if (saleMarketFeeAppIdGet !== undefined)
            console.debug(`itemsToGet: (${itemsToGet.length}) ${itemsToGet}`)
        itemsToGet.forEach(item => {
            console.debug(`item: ${item}`)

            var itemIsSaleItem = item.market_fee_app === saleMarketFeeAppIdGet
            console.debug(`itemIsSaleItem: ${itemIsSaleItem}`)
            if (itemIsSaleItem) {
                specialCardGet(item, offer);
            }
        })

        console.debug(`saleMarketFeeAppIdGet: ${saleMarketFeeAppIdGive}`)
        if (saleMarketFeeAppIdGive !== undefined)
            console.debug(`itemsToGive: (${itemsToGive.length}) ${itemsToGive}`)
        itemsToGive.forEach(item => {
            console.debug(`item: ${item}`)

            var itemIsSaleItem = saleMarketFeeAppIdGive.filter(id => id === item.market_fee_app).length >> 0 && saleCardsToGiveValid
            console.debug(`itemIsSaleItem: ${itemIsSaleItem}`)
            if (itemIsSaleItem) {
                specialCardGive(item, offer);
            }
        })

        //checks cross set cards: X of my cards for X*2 or more cards of the trade partner (2:4 = ok; 2:5 = ok; 2:3 = not ok)
        var normalCardsToGive = itemsToGive.filter(item =>
            item.tags.find(tag => tag.category === "cardborder")
                .internal_name === "cardborder_0").length;

        var normalCardsToReceive = itemsToGet.filter(item =>
            item.tags.find(tag => tag.category === "cardborder")
                .internal_name === "cardborder_0").length;

        var foilCardsToGive = itemsToGive.filter(item =>
            item.tags.find(tag => tag.category === "cardborder")
                .internal_name === "cardborder_1").length;
        var foilCardsToReceive = itemsToGet.filter(item =>
            item.tags.find(tag => tag.category === "cardborder")
                .internal_name === "cardborder_1").length


        itemsToGive.forEach(item => {
            console.log(`Card to give left: ${item.market_name} (${item.type})`)
        })

        itemsToGet.forEach(item => {
            console.log(`Card to receive left: ${item.market_name} (${item.type})`)
        })

        console.log(`${normalCardsToGive} cards to give and ${normalCardsToReceive} cards to receive left.`);
        console.log(`${foilCardsToGive} foil cards to give and ${foilCardsToReceive} foil cards to receive left.`);

        var crossSetItemCountValid = (normalCardsToGive !== undefined && normalCardsToGive * 2 <= normalCardsToReceive)
            && (foilCardsToGive !== undefined && foilCardsToGive * 2 <= foilCardsToReceive);
        console.debug(`crossSetItemCountValid: ${crossSetItemCountValid}`)

        var crossSetItemCountValidFriends = (normalCardsToGive !== undefined && normalCardsToGive * 2 <= normalCardsToReceive)
            && (foilCardsToGive !== undefined && foilCardsToGive * 2 <= foilCardsToReceive);
        console.debug(`crossSetItemCountValidFriends: ${crossSetItemCountValidFriends}`)
    }

    var tradeAcceptCondition = itemsToReceiveAreTradingCards && (itemsToGiveAreTradingCards || itemsToGive.length === 0) && ((crossSetItemCountValid || (offerFromFriend && crossSetItemCountValidFriends)) || itemsToGive.length === 0) && saleCardsToGiveValid
    console.debug(`tradeAcceptCondition: ${tradeAcceptCondition}`)
    if (tradeAcceptCondition) {
        acceptOffer(offer)
    } else {
        console.log(`${logTradeValidationResultPrefix} Can't validate offer ${offer.id}, please check manually`)
    }
    console.log(`${logTradeValidationStepsPrefix} end of offer validation for ${offer.id}`)
});

function acceptOffer(offer) {
    offer.accept((err, status) => {
        if (err && err.message !== "Not Logged In") {
            console.log(err);
        } else if (err && err.message === "Not Logged In") {

            console.log(`${logAuthPrefix} Session timed out. Re-login`)

            // login if session is expired and error has been thrown
            client.logOn(loginDetails);
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

function oneForOne(itemToGive, offer) {
    let itemsToGiveOfGameInTrade = itemsToGive.filter(item =>
        item.market_fee_app === itemToGive.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGive.tags.find(tag => tag.category === "cardborder").internal_name);
    console.debug(`itemsToGiveOfGameInTrade: (${itemsToGiveOfGameInTrade.length}) ${itemsToGiveOfGameInTrade}`)

    let itemsToReceiveOfGameInTrade = offer.itemsToReceive.filter(item =>
        item.market_fee_app === itemToGive.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGive.tags.find(tag => tag.category === "cardborder").internal_name);
    console.debug(`itemsToReceiveOfGameInTrade: (${itemsToReceiveOfGameInTrade.length}) ${itemsToReceiveOfGameInTrade}`)

    if (itemsToReceiveOfGameInTrade.length >> 0 && itemsToGiveOfGameInTrade.length >> 0) {
        var count = 0;
        while (count + 1 <= itemsToReceiveOfGameInTrade.length && count + 1 <= itemsToGiveOfGameInTrade.length) {
            itemsToGive.splice(itemsToGive.indexOf(itemsToGiveOfGameInTrade.at(count)), 1)
            console.log(`Sorted card to give out: ${itemsToGiveOfGameInTrade.at(count).market_name}`)

            itemsToGet.splice(itemsToGet.indexOf(itemsToReceiveOfGameInTrade.at(count)), 1) // us this for 1:1 trades
            console.log(`Sorted card to receive out: ${itemsToReceiveOfGameInTrade.at(count).market_name}`)

            count++;
        }
        console.log(`${count} cards each side sorted out because of 1:1 trades for ${itemToGive.type}.`)
        console.log(`${logTradeValidationStepsPrefix}`)
        /*for (var j = 0; j < itemsToReceiveOfGameInTrade.length; j++) {
            itemsToGet.splice(itemsToGet.indexOf(itemsToReceiveOfGameInTrade.at(j)), 1) // use this for 2:1 trades
        }*/
    }
}

function specialCardGet(itemToGet, offer) {
    let itemsToGiveOfGameInTrade = itemsToGive.filter(item =>
        item.market_fee_app !== itemToGet.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGet.tags.find(tag => tag.category === "cardborder").internal_name);
    console.debug(`itemsToGiveOfGameInTrade: (${itemsToGiveOfGameInTrade.length}) ${itemsToGiveOfGameInTrade}`)

    let itemsToReceiveOfGameInTrade = itemsToGet.filter(item =>
        item.market_fee_app === itemToGet.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGet.tags.find(tag => tag.category === "cardborder").internal_name);
    console.debug(`itemsToReceiveOfGameInTrade: (${itemsToReceiveOfGameInTrade.length}) ${itemsToReceiveOfGameInTrade}`)

    // get 1 special card, receive 2 non-special cards
    var conditionsToGiveSpecialCard = (itemsToReceiveOfGameInTrade.length >= 1 && itemsToGiveOfGameInTrade.length >= 2) && itemsToGiveOfGameInTrade.length <= itemsToReceiveOfGameInTrade.length * 2;
    console.debug(`conditionsToGiveSpecialCard: ${conditionsToGiveSpecialCard}`)
    if (conditionsToGiveSpecialCard) {
        for (var i = 0; i < itemsToReceiveOfGameInTrade.length * 2; i++) {
            itemsToGive.splice(itemsToGive.indexOf(itemsToGiveOfGameInTrade.at(i)), 1)
            console.log(`Sorted card to give out: ${itemsToGiveOfGameInTrade.at(i).market_name} (${itemsToGiveOfGameInTrade.at(i).type})`)
        }
        for (var j = 0; j < itemsToReceiveOfGameInTrade.length; j++) {
            itemsToGet.splice(itemsToGet.indexOf(itemsToReceiveOfGameInTrade.at(j)), 1)
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
    console.debug(`itemsToGiveOfGameInTrade: (${itemsToGiveOfGameInTrade.length}) ${itemsToGiveOfGameInTrade}`)

    let itemsToReceiveOfGameInTrade = itemsToGet.filter(item =>
        item.market_fee_app !== itemToGive.market_fee_app
        && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGive.tags.find(tag => tag.category === "cardborder").internal_name);
    console.debug(`itemsToReceiveOfGameInTrade: (${itemsToReceiveOfGameInTrade.length}) ${itemsToReceiveOfGameInTrade}`)

    // give 1 special card, receive 3 non-special cards
    var conditionsToGiveSpecialCard = (itemsToReceiveOfGameInTrade.length >= 3 && itemsToGiveOfGameInTrade.length >= 1) && itemsToGiveOfGameInTrade.length * 3 <= itemsToReceiveOfGameInTrade.length;
    console.debug(`conditionsToGiveSpecialCard: ${conditionsToGiveSpecialCard}`)
    if (conditionsToGiveSpecialCard) {
        for (var i = 0; i < itemsToGiveOfGameInTrade.length; i++) {
            itemsToGive.splice(itemsToGive.indexOf(itemsToGiveOfGameInTrade.at(i)), 1)
            console.log(`Sorted card to give out: ${itemsToGiveOfGameInTrade.at(i).market_name} (${itemsToGiveOfGameInTrade.at(i).type})`)
        }
        for (var j = 0; j < itemsToGiveOfGameInTrade.length * 3; j++) {
            itemsToGet.splice(itemsToGet.indexOf(itemsToReceiveOfGameInTrade.at(j)), 1)
            console.log(`Sorted card to receive out: ${itemsToReceiveOfGameInTrade.at(j).market_name} (${itemsToReceiveOfGameInTrade.at(j).type})`)
        }
        console.log(`${i} sale cards to give and ${j} sale cards to receive sorted out.`)
        console.log(`${logTradeValidationStepsPrefix}`)
    } else {
        saleCardsToGiveValid = false;
    }
}
