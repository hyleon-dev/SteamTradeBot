class TradeItem {
    constructor({ appId, name, type, border, isTradingCard }) {
        this.appId = appId;           // market_fee_app als String
        this.name = name;             // Kartenname
        this.type = type;             // z.B. "Portal 2 Trading Card"
        this.border = border;         // "cardborder_0" (normal) | "cardborder_1" (foil)
        this.isTradingCard = isTradingCard;
    }
}

class TradeOffer {
    constructor({ id, itemsToReceive, itemsToGive }) {
        this.id = id;
        this.itemsToReceive = itemsToReceive; // TradeItem[]
        this.itemsToGive = itemsToGive;       // TradeItem[]
    }
}

function mapSteamItem(steamItem) {
    return new TradeItem({
        appId: String(steamItem.market_fee_app),
        name: steamItem.name,
        type: steamItem.type,
        border: steamItem.tags.find(t => t.category === "cardborder")?.internal_name,
        isTradingCard: steamItem.tags.find(t => t.name === "Trading Card") != null
    });
}

function mapSteamOffer(steamOffer) {
    return new TradeOffer({
        id: steamOffer.id,
        itemsToReceive: steamOffer.itemsToReceive.map(mapSteamItem),
        itemsToGive: steamOffer.itemsToGive.map(mapSteamItem)
    });
}

function trimItemType(type) {
    return type.replaceAll(" Foil", "").replaceAll(" Trading Card", "");
}

function itemsToText(items) {
    return `[${items.map(item => `'${item.name} (${item.type})'`)}]`;
}

function countByBorder(items, borderName) {
    return items.filter(item => item.border === borderName).length;
}

function pushBlacklistWarning(lines, type, direction, games) {
    if (games.length > 0) {
        const label = games.length === 1 ? 'game' : 'games';
        lines.push(`🚩 ${type} blacklisted ${label} to ${direction} found: ${games.join(', ')} \n`);
    }
}

function buildItemMap(items, blacklist) {
    const map = new Map();
    const blacklistedGames = [];
    let includesBlacklisted = false;
    items.forEach(item => {
        if (!blacklist.includes(item.appId)) {
            const key = item.appId + "_" + item.border;
            if (map.has(key)) map.get(key).push(item);
            else map.set(key, [item]);
        } else {
            includesBlacklisted = true;
            const game = trimItemType(item.type);
            if (!blacklistedGames.includes(game)) blacklistedGames.push(game);
        }
    });
    return { map, blacklistedGames, includesBlacklisted };
}

function filterSoftBlacklist(itemsMap, blacklist) {
    const items = [];
    const blacklistedGames = [];
    let includesBlacklisted = false;
    itemsMap.forEach(mapItems => {
        mapItems.forEach(item => {
            if (!blacklist.includes(item.appId)) {
                items.push(item);
            } else {
                includesBlacklisted = true;
                const game = trimItemType(item.type);
                if (!blacklistedGames.includes(game)) blacklistedGames.push(game);
            }
        });
    });
    return { items, blacklistedGames, includesBlacklisted };
}

function validateOffer(offer, { hardBlacklist, softBlacklist, saleMarketFeeAppIdGet, saleMarketFeeAppIdGive }) {
    let itemsToReceive = Array.from(offer.itemsToReceive);
    let itemsToGive = Array.from(offer.itemsToGive);
    let saleCardsToGiveValid = true;
    let includesHardBlacklisted = false;
    let includesSoftBlacklisted = false;
    const discordLines = [];
    const errorLines = [];

    // Prüfen ob alle Items Trading Cards sind
    const itemsToReceiveAreTradingCards = itemsToReceive.every(item => item.isTradingCard);
    const itemsToGiveAreTradingCards = itemsToGive.every(item => item.isTradingCard);

    if (!itemsToReceiveAreTradingCards || !itemsToGiveAreTradingCards) {
        return { accepted: false, discordLines: ['🔴 Found something other than a trading card in trade.'] };
    }

    // Item-Maps erstellen und Hard-Blacklist filtern
    const { map: itemsToGiveMap, blacklistedGames: hardBLGive, includesBlacklisted: blGive } = buildItemMap(itemsToGive, hardBlacklist.give);
    const { map: itemsToReceiveMap, blacklistedGames: hardBLReceive, includesBlacklisted: blReceive } = buildItemMap(itemsToReceive, hardBlacklist.get);
    if (blGive || blReceive) includesHardBlacklisted = true;
    pushBlacklistWarning(discordLines, 'Hard', 'give', hardBLGive);
    pushBlacklistWarning(discordLines, 'Hard', 'get', hardBLReceive);

    discordLines.push('↔️ Following trades will be made:');

    // 1:1-Trades herausfiltern (gleiche App, gleicher Border, gleiche Anzahl)
    itemsToGiveMap.forEach((items, key) => {
        if (itemsToReceiveMap.has(key) && items.length === itemsToReceiveMap.get(key).length) {
            for (let i = 0; i < items.length; i++) {
                discordLines.push(`➡️ ${itemsToReceiveMap.get(key)[i].name} (${trimItemType(items[i].type)}) \n⬅️ ${items[i].name} (${trimItemType(items[i].type)}) \n`);
            }
            itemsToReceiveMap.delete(key);
            itemsToGiveMap.delete(key);
        } else if (itemsToReceiveMap.has(key) && items.length < itemsToReceiveMap.get(key).length) {
            const poppedItems = [];
            for (let i = 1; i <= items.length; i++) {
                const poppedItem = itemsToReceiveMap.get(key).pop();
                if (poppedItem !== undefined) poppedItems.push(poppedItem);
            }
            for (let i = 0; i < poppedItems.length; i++) {
                discordLines.push(`➡️ ${poppedItems[i].name} (${trimItemType(poppedItems[i].type)}) \n⬅️ ${itemsToGiveMap.get(key)[i].name} (${trimItemType(itemsToGiveMap.get(key)[i].type)}) \n`);
            }
            itemsToGiveMap.delete(key);
        }
    });

    // Soft-Blacklist filtern
    const { items: filteredGive, blacklistedGames: softBLGive, includesBlacklisted: softBlGive } = filterSoftBlacklist(itemsToGiveMap, softBlacklist.give);
    const { items: filteredReceive, blacklistedGames: softBLReceive, includesBlacklisted: softBlReceive } = filterSoftBlacklist(itemsToReceiveMap, softBlacklist.get);
    itemsToGive = filteredGive;
    itemsToReceive = filteredReceive;
    if (softBlGive || softBlReceive) includesSoftBlacklisted = true;
    pushBlacklistWarning(discordLines, 'Soft', 'give', softBLGive);
    pushBlacklistWarning(discordLines, 'Soft', 'get', softBLReceive);

    // Sale-Karten-Logik
    const saleGetId = (saleMarketFeeAppIdGet != null && saleMarketFeeAppIdGet !== "")
        ? String(saleMarketFeeAppIdGet) : null;
    const saleGiveIds = Array.isArray(saleMarketFeeAppIdGive)
        ? saleMarketFeeAppIdGive.map(String) : [];

    if (saleGetId) {
        // Regel "get": 1 Sale-Karte erhalten, 2 normale Karten abgeben
        const receiveSnapshot = [...itemsToReceive];
        receiveSnapshot.forEach(itemToGet => {
            if (itemToGet.appId !== saleGetId) return;

            const giveOfSameBorder = itemsToGive.filter(g => g.appId !== itemToGet.appId && g.border === itemToGet.border);
            const receiveOfSameBorder = itemsToReceive.filter(r => r.appId === itemToGet.appId && r.border === itemToGet.border);
            const conditions = receiveOfSameBorder.length >= 1 && giveOfSameBorder.length >= 2
                && giveOfSameBorder.length <= receiveOfSameBorder.length * 2;

            if (conditions) {
                for (let i = 0; i < receiveOfSameBorder.length * 2 && i < giveOfSameBorder.length; i++) {
                    const idx = itemsToGive.indexOf(giveOfSameBorder[i]);
                    if (idx !== -1) itemsToGive.splice(idx, 1);
                }
                for (let j = 0; j < receiveOfSameBorder.length; j++) {
                    const idx = itemsToReceive.indexOf(receiveOfSameBorder[j]);
                    if (idx !== -1) itemsToReceive.splice(idx, 1);
                }
            }
        });

        // Regel "give": 1 Sale-Karte abgeben, 3 normale Karten erhalten
        const giveSnapshot = [...itemsToGive];
        giveSnapshot.forEach(itemToGive => {
            if (!saleGiveIds.includes(itemToGive.appId) || !saleCardsToGiveValid) return;

            const giveItems = itemsToGive.filter(g => g.appId === itemToGive.appId && g.border === itemToGive.border);
            const receiveItems = itemsToReceive.filter(r => r.appId !== itemToGive.appId && r.border === itemToGive.border);
            const conditions = receiveItems.length >= 3 && giveItems.length >= 1
                && giveItems.length * 3 <= receiveItems.length;

            if (conditions) {
                for (let i = 0; i < giveItems.length; i++) {
                    const idx = itemsToGive.indexOf(giveItems[i]);
                    if (idx !== -1) itemsToGive.splice(idx, 1);
                }
                for (let j = 0; j < giveItems.length * 3; j++) {
                    const idx = itemsToReceive.indexOf(receiveItems[j]);
                    if (idx !== -1) itemsToReceive.splice(idx, 1);
                }
            } else {
                saleCardsToGiveValid = false;
            }
        });
    }

    // Cross-Set-Ratio prüfen (X abgeben, X*2 oder mehr erhalten)
    const normalCardsToGive    = countByBorder(itemsToGive,    "cardborder_0");
    const normalCardsToReceive = countByBorder(itemsToReceive, "cardborder_0");
    const foilCardsToGive      = countByBorder(itemsToGive,    "cardborder_1");
    const foilCardsToReceive   = countByBorder(itemsToReceive, "cardborder_1");

    const crossSetItemCountValid = normalCardsToGive * 2 <= normalCardsToReceive
        && foilCardsToGive * 2 <= foilCardsToReceive;

    // Discord-Zeilen für Cross-Set-Trades
    if (crossSetItemCountValid && itemsToGive.length > 0) {
        for (let i = 0; i < itemsToGive.length; i++) {
            discordLines.push(`➡️ ${itemsToReceive[i * 2].name} (${trimItemType(itemsToReceive[i * 2].type)}) \n➡️ ${itemsToReceive[i * 2 + 1].name} (${trimItemType(itemsToReceive[i * 2 + 1].type)}) \n⬅️ ${itemsToGive[i].name} (${trimItemType(itemsToGive[i].type)}) \n`);
        }
    }

    // Annahmebedingung (entspricht tradeAcceptCondition in der ursprünglichen index.js)
    const accepted = (itemsToGiveAreTradingCards || itemsToGive.length === 0)
        && (crossSetItemCountValid || itemsToGive.length === 0)
        && saleCardsToGiveValid
        && !includesHardBlacklisted
        && !includesSoftBlacklisted;

    if (!accepted) {
        if (!itemsToGiveAreTradingCards && itemsToGive.length > 0) errorLines.push('🔴 Found something other than a trading card in trade.');
        if (!crossSetItemCountValid && itemsToGive.length > 0) errorLines.push('🔴 Cross trading does not add up');
        if (!saleCardsToGiveValid) errorLines.push('🔴 Found error within sale card trading');
        if (includesHardBlacklisted) errorLines.push('🔴 Trade contains hard blacklisted game');
        if (includesSoftBlacklisted) errorLines.push('🔴 Cross trading contains soft blacklisted game');
    }

    return { accepted, discordLines, errorLines };
}

module.exports = {
    TradeItem,
    TradeOffer,
    mapSteamItem,
    mapSteamOffer,
    validateOffer,
    itemsToText
};
