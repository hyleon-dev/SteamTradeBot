const { mapSteamItem, trimItemType } = require('./utils');

// Groups the trading cards of the bot inventory by set (app + normal/foil).
// steamItems: items of Steam app 753, context 6. Other items (backgrounds, gems, ...) are skipped.
// rules: { neverGive: appIds[], duplicatesOnly: appIds[] }
function groupCardsBySet(steamItems, { neverGive = [], duplicatesOnly = [] } = {}) {
    const sets = new Map();
    steamItems.forEach(steamItem => {
        const item = mapSteamItem(steamItem);
        if (!item.isTradingCard) return;
        const foil = item.border === 'cardborder_1';
        const key = `${item.appId}_${foil ? 1 : 0}`;
        if (!sets.has(key)) {
            sets.set(key, {
                appId: item.appId,
                game: trimItemType(item.type || ''),
                foil,
                protection: neverGive.includes(item.appId) ? 'never_give'
                    : duplicatesOnly.includes(item.appId) ? 'duplicates_only' : null,
                cards: new Map(),
            });
        }
        const cards = sets.get(key).cards;
        const card = cards.get(item.market_hash_name) || {
            name: item.name,
            market_hash_name: item.market_hash_name,
            image_url: item.image_url,
            count: 0,
            tradable: 0,
        };
        card.count++;
        if (steamItem.tradable) card.tradable++;
        cards.set(item.market_hash_name, card);
    });

    return Array.from(sets.values()).map(set => {
        const cards = Array.from(set.cards.values()).sort((a, b) => a.name.localeCompare(b.name));
        return {
            ...set,
            cards,
            distinct: cards.length,
            total: cards.reduce((sum, c) => sum + c.count, 0),
            duplicates: cards.reduce((sum, c) => sum + Math.max(0, c.count - 1), 0),
        };
    }).sort((a, b) => a.game.localeCompare(b.game) || Number(a.foil) - Number(b.foil));
}

// Number of cards in a set, read from the HTML of a badge page (/gamecards/<appId>/).
// Each card of the set has a "badge_card_set_card" element, owned or not.
// Returns null if the page has no such element (private profile, error page, other layout).
function parseSetSize(html) {
    const matches = String(html || '').match(/class="badge_card_set_card[\s"]/g);
    return matches && matches.length > 0 ? matches.length : null;
}

module.exports = { groupCardsBySet, parseSetSize };
