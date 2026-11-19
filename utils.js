const fs = require('fs/promises');
const path = require('path');
const logger = require('./logger');

// Local folder for cached images
const CACHE_DIR = path.join(__dirname, 'image_cache');

class TradeItem {
    constructor({ appId, name, market_hash_name, type, border, image_url, isTradingCard }) {
        this.appId = appId;           // market_fee_app as string
        this.name = name;             // card name
        this.market_hash_name = market_hash_name; // name in the Steam market URL
        this.type = type;             // e.g. "Portal 2 Trading Card"
        this.border = border;         // "cardborder_0" (normal) | "cardborder_1" (foil)
        this.image_url = image_url;   // card image
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
        market_hash_name: steamItem.market_hash_name,
        type: steamItem.type,
        border: steamItem.tags.find(t => t.category === "cardborder")?.internal_name,
        image_url: steamItem.icon_url_large,   // raw Steam image ID. /images/:id caches the image on first use
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

// Readable card name, e.g. "Companion Cube (Portal 2, Foil)".
function cardLabel(item) {
    if (!item.isTradingCard) return `${item.name} (${item.type})`;
    const foil = item.border === 'cardborder_1' ? ', Foil' : '';
    return `${item.name} (${trimItemType(item.type)}${foil})`;
}

// Card list with counts, e.g. "2× A (Game), B (Game)".
function formatCards(items) {
    const counts = new Map();
    items.forEach(item => {
        const label = cardLabel(item);
        counts.set(label, (counts.get(label) || 0) + 1);
    });
    return Array.from(counts, ([label, count]) => (count > 1 ? `${count}× ${label}` : label)).join(', ');
}

// Splits items into allowed and blocked items. Groups allowed items by app + border.
function buildItemMap(items, blacklist) {
    const map = new Map();
    const blocked = [];
    items.forEach(item => {
        if (blacklist.includes(item.appId)) {
            blocked.push(item);
            return;
        }
        const key = item.appId + "_" + item.border;
        if (map.has(key)) map.get(key).push(item);
        else map.set(key, [item]);
    });
    return { map, blocked };
}

function filterSoftBlacklist(itemsMap, blacklist) {
    const items = [];
    const blocked = [];
    itemsMap.forEach(mapItems => {
        mapItems.forEach(item => (blacklist.includes(item.appId) ? blocked : items).push(item));
    });
    return { items, blocked };
}

// Counts items per market_hash_name. Normal and foil have different names.
function countByName(items) {
    const counts = new Map();
    items.forEach(item => counts.set(item.market_hash_name, (counts.get(item.market_hash_name) || 0) + 1));
    return counts;
}

// Soft-give games: the bot gives only duplicates. After the trade it must keep at least 1 copy of each card.
// ownedCounts: Map market_hash_name -> count in bot inventory. null = inventory not loaded.
// Returns the names of cards the bot would lose. null = check not possible.
function findLastCopies(offer, softGiveIds, ownedCounts) {
    const give = offer.itemsToGive.filter(item => softGiveIds.includes(item.appId));
    if (give.length === 0) return [];
    if (!ownedCounts) return null;
    const giveCounts = countByName(give);
    const receiveCounts = countByName(offer.itemsToReceive);
    const lost = [];
    giveCounts.forEach((given, name) => {
        const left = (ownedCounts.get(name) || 0) - given + (receiveCounts.get(name) || 0);
        if (left < 1) lost.push(name);
    });
    return lost;
}

// Checks all rules. Does not stop at the first problem.
// reasons: [{ code, text, clear }]. clear = bot can decline without a manual check.
function validateOffer(offer, { hardBlacklist, softBlacklist, saleMarketFeeAppIdGet, saleMarketFeeAppIdGive, ownedCounts = null }) {
    const reasons = [];
    const discordLines = [];
    const addReason = (code, text, clear = false) => reasons.push({ code, text: `🔴 ${text}`, clear });

    // Items that are not trading cards. They are reported and not checked further.
    const nonCardsGive = offer.itemsToGive.filter(item => !item.isTradingCard);
    const nonCardsReceive = offer.itemsToReceive.filter(item => !item.isTradingCard);
    if (nonCardsGive.length > 0) {
        addReason('non_card_give', `Bot would give items that are not trading cards: ${formatCards(nonCardsGive)}`, true);
    }
    if (nonCardsReceive.length > 0) {
        // Not a clear case. Received extras can be a gift.
        addReason('non_card_get', `Bot would get items that are not trading cards: ${formatCards(nonCardsReceive)}`);
    }
    let itemsToGive = offer.itemsToGive.filter(item => item.isTradingCard);
    let itemsToReceive = offer.itemsToReceive.filter(item => item.isTradingCard);

    // Soft-give games: only duplicates may leave the inventory
    const softGiveCards = itemsToGive.filter(item => softBlacklist.give.includes(item.appId));
    const lastCopies = findLastCopies({ itemsToGive, itemsToReceive }, softBlacklist.give, ownedCounts);
    if (lastCopies === null) {
        addReason('inventory_missing', `Bot inventory could not be loaded. Cannot check if these protected cards are duplicates: ${formatCards(softGiveCards)}`);
    } else if (lastCopies.length > 0) {
        // Last copy is a clear case only in an N:N offer where each given card is blocked.
        // A card is blocked if the bot may give 0 copies of it (has at most 1, received copies included).
        // If one given card is fine, a manual check is needed.
        const receivedByName = countByName(itemsToReceive);
        const isEvenSwap = nonCardsGive.length === 0 && nonCardsReceive.length === 0
            && itemsToGive.length > 0 && itemsToGive.length === itemsToReceive.length;
        const allGivenBlocked = itemsToGive.every(item => softBlacklist.give.includes(item.appId)
            && (ownedCounts.get(item.market_hash_name) || 0) + (receivedByName.get(item.market_hash_name) || 0) <= 1);
        const givenByName = countByName(softGiveCards);
        const details = lastCopies.map(name => {
            const item = softGiveCards.find(i => i.market_hash_name === name);
            const back = receivedByName.get(name) ? `, gets back ${receivedByName.get(name)}` : '';
            return `${cardLabel(item)}: has ${ownedCounts.get(name) || 0}, gives ${givenByName.get(name)}${back}`;
        });
        addReason('last_copy', `Bot would give its last copy of protected cards: ${details.join('; ')}`, isEvenSwap && allGivenBlocked);
    }

    // Hard blacklist
    const { map: itemsToGiveMap, blocked: neverGive } = buildItemMap(itemsToGive, hardBlacklist.give);
    const { map: itemsToReceiveMap, blocked: neverGet } = buildItemMap(itemsToReceive, hardBlacklist.get);
    if (neverGive.length > 0) {
        addReason('never_give', `Bot would give cards of games it never gives (NEVER_GIVE): ${formatCards(neverGive)}`, true);
    }
    if (neverGet.length > 0) {
        addReason('never_get', `Bot would get cards of games it never takes (NEVER_GET): ${formatCards(neverGet)}`);
    }

    discordLines.push('↔️ Following trades will be made:');

    // Filter out 1:1 trades (same app, same border, same count)
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

    // Soft blacklist: cards left after the 1:1 swaps are not allowed
    const { items: filteredGive, blocked: softGiveLeft } = filterSoftBlacklist(itemsToGiveMap, softBlacklist.give);
    const { items: filteredReceive, blocked: softGetLeft } = filterSoftBlacklist(itemsToReceiveMap, softBlacklist.get);
    itemsToGive = filteredGive;
    itemsToReceive = filteredReceive;
    if (softGiveLeft.length > 0) {
        addReason('same_set_give', `Bot gives these protected cards only 1:1 for cards of the same set and type, but not here: ${formatCards(softGiveLeft)}`);
    }
    if (softGetLeft.length > 0) {
        addReason('same_set_get', `Bot takes these cards only 1:1 for cards of the same set and type, but not here: ${formatCards(softGetLeft)}`);
    }

    // Sale card logic
    const saleGetId = (saleMarketFeeAppIdGet != null && saleMarketFeeAppIdGet !== "")
        ? String(saleMarketFeeAppIdGet) : null;
    const saleGiveIds = Array.isArray(saleMarketFeeAppIdGive)
        ? saleMarketFeeAppIdGive.map(String) : [];

    if (saleGetId) {
        // Rule "get": receive 1 sale card, give 2 normal cards
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
    }

    // Runs without "get" too. Else sale cards to give use the normal 1:2 ratio.
    if (saleGiveIds.length > 0) {
        // Rule "give": give 1 sale card, receive 3 normal cards
        const giveSnapshot = [...itemsToGive];
        giveSnapshot.forEach(itemToGive => {
            if (!saleGiveIds.includes(itemToGive.appId)) return;
            // Card was already counted in an earlier iteration (same app + border).
            if (!itemsToGive.includes(itemToGive)) return;

            const giveItems = itemsToGive.filter(g => g.appId === itemToGive.appId && g.border === itemToGive.border);
            const receiveItems = itemsToReceive.filter(r => r.appId !== itemToGive.appId && r.border === itemToGive.border);
            const conditions = receiveItems.length >= 3 && giveItems.length >= 1
                && giveItems.length * 3 <= receiveItems.length;

            if (!conditions) {
                const type = itemToGive.border === 'cardborder_1' ? 'foil' : 'normal';
                addReason('sale_give', `Bot gives sale cards only for 3 ${type} cards each. It gives ${formatCards(giveItems)} and needs ${giveItems.length * 3}, but gets only ${receiveItems.length}`);
            }
            // Remove the sale cards in both cases. A failed group is reported above and not again in the ratio check.
            for (let i = 0; i < giveItems.length; i++) {
                const idx = itemsToGive.indexOf(giveItems[i]);
                if (idx !== -1) itemsToGive.splice(idx, 1);
            }
            if (conditions) {
                for (let j = 0; j < giveItems.length * 3; j++) {
                    const idx = itemsToReceive.indexOf(receiveItems[j]);
                    if (idx !== -1) itemsToReceive.splice(idx, 1);
                }
            }
        });
    }

    // Check cross-set ratio (give X, receive X*2 or more). Normal and foil are counted separately.
    const unknownBorder = itemsToGive.filter(item => item.border !== "cardborder_0" && item.border !== "cardborder_1");
    if (unknownBorder.length > 0) {
        // Cards with unknown border are not counted. Without this check the bot gives them away for nothing.
        addReason('unknown_type', `Bot cannot tell if these cards are normal or foil: ${formatCards(unknownBorder)}`);
    }
    let crossSetItemCountValid = unknownBorder.length === 0;
    [['cardborder_0', 'normal'], ['cardborder_1', 'foil']].forEach(([border, type]) => {
        const give = itemsToGive.filter(item => item.border === border);
        const receive = itemsToReceive.filter(item => item.border === border);
        if (give.length * 2 <= receive.length) return;
        crossSetItemCountValid = false;
        const got = receive.length > 0 ? `: ${formatCards(receive)}` : '';
        addReason('ratio', `Cross-set trade needs 2 ${type} cards for each ${type} card. Bot gives ${give.length} (${formatCards(give)}) and needs ${give.length * 2}, but gets ${receive.length}${got}`);
    });

    // Discord lines for cross-set trades
    if (crossSetItemCountValid && itemsToGive.length > 0) {
        for (let i = 0; i < itemsToGive.length; i++) {
            discordLines.push(`➡️ ${itemsToReceive[i * 2].name} (${trimItemType(itemsToReceive[i * 2].type)}) \n➡️ ${itemsToReceive[i * 2 + 1].name} (${trimItemType(itemsToReceive[i * 2 + 1].type)}) \n⬅️ ${itemsToGive[i].name} (${trimItemType(itemsToGive[i].type)}) \n`);
        }
    }

    const accepted = reasons.length === 0;
    // A clear reason declines the whole offer, also if there are other reasons.
    const autoDecline = reasons.some(reason => reason.clear);
    const errorLines = reasons.map(reason => reason.text);

    return { accepted, autoDecline, reasons, discordLines, errorLines };
}

// Steam image IDs can contain '/' and similar chars -> convert to a safe file name.
function cacheFileName(id) {
    return String(id).replace(/[^A-Za-z0-9._-]/g, '_');
}

// Loads the image for a Steam image ID into the local cache (if not there yet).
// Returns the absolute path of the cached file.
async function loadImage(id) {
    if (!id) {
        return null;
    }   // no image ID -> nothing to load

    // Make sure the cache folder exists
    await fs.mkdir(CACHE_DIR, {recursive: true});

    const filePath = path.join(CACHE_DIR, cacheFileName(id));

    try {
        // Check if the file exists already
        await fs.access(filePath);
        return filePath;
    } catch {
        // File does not exist -> download it
        const url = `https://community.akamai.steamstatic.com/economy/image/${id}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Could not load image: ${response.statusText}`);
        }

        // Read image data and write it to disk
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        await fs.writeFile(filePath, buffer);

        return filePath;
    }
}

module.exports = {
    TradeItem,
    TradeOffer,
    mapSteamItem,
    mapSteamOffer,
    validateOffer,
    itemsToText,
    trimItemType,
    loadImage
};
