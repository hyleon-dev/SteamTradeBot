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

var friends = Array.from(config.friends);
var identitySecret = config.identity_secret;
var saleMarketFeeAppId = config.sale_market_fee_app_id

// Disables asking for Steam Guard Code
client.setOption("promptSteamGuardCode", false);

client.logOn({
    accountName: config.username,
    password: config.password,
    logonID: Math.floor(Math.random() * 1000) + 1
});

// Log in
client.on('loggedOn', () => {
    console.log('Logged into Steam!');
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
        console.log("Last code wrong, try again!");
    } else {
        console.log("Authorized with Steam Guard Code")
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

    console.log(`==== start of offer validation for ${offer.id} ====`)

    var offerFromFriend = friends.find(acc => acc === offer.partner.getSteamID64()) != null;

    var itemsToGet = Array.from(offer.itemsToReceive);
    var itemsToGive = Array.from(offer.itemsToGive);

    // check if offer only contains trading cards
    var itemsToReceiveAreTradingCards = offer.itemsToReceive.every(item => {
        return item.tags.find(tag => tag.name === "Trading Card") != null
    });
    var itemsToGiveAreTradingCards = offer.itemsToGive.every(item => {
        return item.tags.find(tag => tag.name === "Trading Card") != null
    });

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
            var itemsToGiveOfGameInTrade = offer.itemsToGive.filter(item =>
                item.market_fee_app === itemToGive.market_fee_app
                && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGive.tags.find(tag => tag.category === "cardborder").internal_name);
            var itemsToReceiveOfGameInTrade = offer.itemsToReceive.filter(item =>
                item.market_fee_app === itemToGive.market_fee_app
                && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGive.tags.find(tag => tag.category === "cardborder").internal_name);

            if (itemsToReceiveOfGameInTrade.length >> 0 && itemsToGiveOfGameInTrade.length >> 0) {
                var count = 0;
                while (count +1 <= itemsToReceiveOfGameInTrade.length && count +1 <= itemsToGiveOfGameInTrade.length) {
                    itemsToGive.splice(itemsToGive.indexOf(itemsToGiveOfGameInTrade.at(count)), 1)
                    console.log(`Sorted card to give out: ${itemsToGiveOfGameInTrade.at(count).market_name}`)
                    itemsToGet.splice(itemsToGet.indexOf(itemsToReceiveOfGameInTrade.at(count)), 1) // us this for 1:1 trades
                    console.log(`Sorted card to receive out: ${itemsToReceiveOfGameInTrade.at(count).market_name}`)
                    count++;
                }
                console.log(`${count} cards each side sorted out because of 1:1 trades for ${itemToGive.type}.`)
                console.log(`====`)
                /*for (var j = 0; j < itemsToReceiveOfGameInTrade.length; j++) {
                    itemsToGet.splice(itemsToGet.indexOf(itemsToReceiveOfGameInTrade.at(j)), 1) // use this for 2:1 trades
                }*/
            }
        })

        // removes cards for special sale cards condition
        itemsToGet.forEach(itemToGet => {
            if (itemToGet.market_fee_app === saleMarketFeeAppId) {
                var itemsToGiveOfGameInTrade = itemsToGive.filter(item =>
                    item.market_fee_app !== itemToGet.market_fee_app
                    && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGet.tags.find(tag => tag.category === "cardborder").internal_name);
                var itemsToReceiveOfGameInTrade = itemsToGet.filter(item =>
                    item.market_fee_app === itemToGet.market_fee_app
                    && item.tags.find(tag => tag.category === "cardborder").internal_name === itemToGet.tags.find(tag => tag.category === "cardborder").internal_name);

                if (itemsToGiveOfGameInTrade.length <= itemsToReceiveOfGameInTrade.length * 2) {
                    for (var i = 0; i < itemsToReceiveOfGameInTrade.length * 2; i++) {
                        itemsToGive.splice(itemsToGive.indexOf(itemsToGiveOfGameInTrade.at(i)), 1)
                        console.log(`Sorted card to give out: ${itemsToGiveOfGameInTrade.at(i).market_name} (${itemsToGiveOfGameInTrade.at(i).type})`)
                    }
                    for (var j = 0; j < itemsToReceiveOfGameInTrade.length; j++) {
                        itemsToGet.splice(itemsToGet.indexOf(itemsToReceiveOfGameInTrade.at(j)), 1)
                        console.log(`Sorted card to receive out: ${itemsToReceiveOfGameInTrade.at(j).market_name} (${itemsToReceiveOfGameInTrade.at(j).type})`)
                    }
                    console.log(`${i} sale cards to give and ${j} sale cards to receive sorted out.`)
                    console.log(`====`)
                }
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

        var crossSetItemCountValid = normalCardsToGive * 2 <= normalCardsToReceive
            && foilCardsToGive * 2 <= foilCardsToReceive;

        var crossSetItemCountValidFriends = normalCardsToGive * 2 <= normalCardsToReceive
            && foilCardsToGive * 2 <= foilCardsToReceive;

        itemsToGive.forEach(item => {
            console.log(`Card to give left: ${item.market_name} (${item.type})`)
        })

        itemsToGet.forEach(item => {
            console.log(`Card to receive left: ${item.market_name} (${item.type})`)
        })

        console.log(`${normalCardsToGive} cards to give and ${normalCardsToReceive} cards to receive left.`);
        console.log(`${foilCardsToGive} foil cards to give and ${foilCardsToReceive} foil cards to receive left.`);

    }


    if (itemsToReceiveAreTradingCards && (itemsToGiveAreTradingCards || itemsToGive.length === 0) && ((crossSetItemCountValid || (offerFromFriend && crossSetItemCountValidFriends)) || itemsToGive.length === 0)) {
        offer.accept((err, status) => {
            if (err) {
                console.log(err);
            } else {
                console.log(`Accepted offer ${offer.id}.`);
                community.acceptConfirmationForObject(identitySecret, offer.id, (err, status) => {
                    if (err) {
                        console.log(err)
                    } else {
                        console.log(`Confirmed offer ${offer.id}.`);
                        trades.inc();
                        cardsGiven.inc(offer.itemsToGive.length);
                        cardsReceived.inc(offer.itemsToReceive.length);
                    }
                });
            }
        });
    } else {
        console.log(`Can't validate offer ${offer.id}, please check manually`)
    }
    console.log(`==== end of offer validation for ${offer.id} ====`)
});
