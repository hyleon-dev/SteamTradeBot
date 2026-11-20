// Trade rules per set (app ID). The rules can be combined.
//
// Each card in an offer is in one of 3 trade kinds:
//   swap: same-set swap. Same game and same type (normal or foil), 1:1, 2:2, ...
//   give: bot gives the card in a cross-set trade (gives 1, gets 2 cards of other games).
//   get:  bot gets the card in a cross-set trade. The other received cards can be of any game.
// Cross-set trades count all cross-set cards together: for each card the bot gives, it gets at least 2.
//
// How the lists combine for one set:
//   1. No "only" list: all 3 kinds are allowed.
//      One or more "only" lists: only the kinds of these lists are allowed.
//   2. neverGive removes swap and give. neverGet removes swap and get.
//   3. blocked removes all kinds.
// duplicatesOnly is separate. The bot keeps at least 1 copy of each card it gives.

const ALL_KINDS = ['swap', 'give', 'get'];

function buildSetRules({
    blocked = [], neverGive = [], neverGet = [],
    onlySwap = [], onlyGive = [], onlyGet = [], duplicatesOnly = [],
} = {}) {
    const lists = { blocked, neverGive, neverGet, onlySwap, onlyGive, onlyGet, duplicatesOnly };
    Object.keys(lists).forEach(key => { lists[key] = lists[key].map(String); });
    const has = (key, appId) => lists[key].includes(String(appId));

    // Returns { swap, give, get } with true for each allowed kind.
    function allowed(appId) {
        const only = [];
        if (has('onlySwap', appId)) only.push('swap');
        if (has('onlyGive', appId)) only.push('give');
        if (has('onlyGet', appId)) only.push('get');
        const kinds = new Set(only.length > 0 ? only : ALL_KINDS);
        if (has('neverGive', appId)) { kinds.delete('swap'); kinds.delete('give'); }
        if (has('neverGet', appId)) { kinds.delete('swap'); kinds.delete('get'); }
        if (has('blocked', appId)) kinds.clear();
        return { swap: kinds.has('swap'), give: kinds.has('give'), get: kinds.has('get') };
    }

    // App IDs in any list where the bot cannot give at all (no swap, no give).
    function neverGiveIds() {
        const ids = new Set(Object.values(lists).flat());
        return [...ids].filter(appId => {
            const a = allowed(appId);
            return !a.swap && !a.give;
        });
    }

    return { allowed, neverGiveIds, duplicatesOnly: lists.duplicatesOnly };
}

module.exports = { buildSetRules };
