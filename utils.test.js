const { TradeItem, TradeOffer, validateOffer, mapSteamItem, mapSteamOffer } = require('./utils');
const { buildSetRules } = require('./setRules');

// Default config without set rules and without sale cards
const DEFAULT_CONFIG = {
    setRules: buildSetRules(),
    saleMarketFeeAppIdGet: null,
    saleMarketFeeAppIdGive: []
};

// Config with set rules. lists: see buildSetRules.
function withRules(lists, extra = {}) {
    return { ...DEFAULT_CONFIG, setRules: buildSetRules(lists), ...extra };
}

// Old "give only same-set duplicates" rule: only swaps, only duplicates
const DUPES_SWAP_99 = { onlySwap: ['99'], duplicatesOnly: ['99'] };

// Creates a normal trading card as TradeItem
function card(appId, border = 'cardborder_0', name = 'Test Card') {
    return new TradeItem({
        appId: String(appId),
        name: name,
        market_hash_name: `${appId}-${name}${border === 'cardborder_1' ? ' (Foil)' : ''}`,
        type: `Game${appId} Trading Card`,
        border,
        isTradingCard: true
    });
}

// Creates an item that is NOT a trading card
function nonCard(appId) {
    return new TradeItem({
        appId: String(appId),
        name: 'Some Item',
        type: 'Some Item Type',
        border: 'cardborder_0',
        isTradingCard: false
    });
}

// Reason codes of a result
function codes(result) {
    return result.reasons.map(r => r.code);
}

// Creates a TradeOffer object
function offer(give, receive) {
    return new TradeOffer({ id: 'test-offer', itemsToGive: give, itemsToReceive: receive });
}

// ─── Cross-Set-Trades ────────────────────────────────────────────────────────

describe('Cross-Set-Trades', () => {
    test('give 1, receive 2 → accepted', () => {
        const result = validateOffer(
            offer([card(1)], [card(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('give 2, receive 4 → accepted', () => {
        const result = validateOffer(
            offer([card(1), card(1)], [card(2), card(2), card(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('give 1, receive 3 → accepted (more is ok)', () => {
        const result = validateOffer(
            offer([card(1)], [card(2), card(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('give 2, receive 3 → declined (ratio too low)', () => {
        const result = validateOffer(
            offer([card(1), card(1)], [card(2), card(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('ratio');
    });

    test('give 1, receive 1 (different games) → declined', () => {
        const result = validateOffer(
            offer([card(1)], [card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(false);
    });
});

// ─── 1:1 Same-Game-Trades ────────────────────────────────────────────────────

describe('1:1 Same-Game-Trades', () => {
    test('2:2 same game → accepted', () => {
        const result = validateOffer(
            offer([card(1), card(1)], [card(1), card(1)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('give 2, receive 1 of same game + 2 of other game → accepted', () => {
        // 1:1 swap of game 1, then the second card of game 1 for 2 cards of game 2
        const result = validateOffer(
            offer([card(1), card(1)], [card(1), card(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('1:1 same game + 1:2 cross-set → accepted', () => {
        // Game 1 is filtered out as 1:1. Game 2 (give) for game 3 (receive) stays as 1:2
        const result = validateOffer(
            offer([card(1), card(2)], [card(1), card(3), card(3)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });
});

// ─── Non-Trading-Card-Items ──────────────────────────────────────────────────

describe('Non-Trading-Card-Items', () => {
    test('no trading card in receive → declined', () => {
        const result = validateOffer(
            offer([card(1)], [nonCard(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(false);
    });

    test('no trading card in give → declined', () => {
        const result = validateOffer(
            offer([nonCard(1), card(1)], [card(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(false);
    });
});

// ─── Hard-Blacklist ──────────────────────────────────────────────────────────

describe('Hard-Blacklist', () => {
    test('hard blacklisted game in receive → declined', () => {
        const config = withRules({ neverGet: ['99'] });
        const result = validateOffer(
            offer([card(1), card(1)], [card(99), card(99), card(99), card(99)]),
            config
        );
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('never_get');
    });

    test('hard blacklisted game in give → declined', () => {
        const config = withRules({ neverGive: ['99'] });
        const result = validateOffer(
            offer([card(99), card(99)], [card(2), card(2), card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('never_give');
    });

    const neverGet = withRules({ neverGet: ['99'] });

    test('NEVER_GET game 1:1 same set → declined', () => {
        const result = validateOffer(offer([card(99, 'cardborder_0', 'A')], [card(99, 'cardborder_0', 'B')]), neverGet);
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('never_get');
    });

    test('NEVER_GET game 3:3 same set → declined', () => {
        const result = validateOffer(offer([card(99), card(99), card(99)], [card(99), card(99), card(99)]), neverGet);
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('never_get');
    });

    test('NEVER_GET game: give 1, receive 2 of other set → accepted', () => {
        const result = validateOffer(offer([card(99)], [card(2), card(2)]), neverGet);
        expect(result.accepted).toBe(true);
    });

    test('NEVER_GET game: give 2, receive 4 of other set → accepted', () => {
        const result = validateOffer(offer([card(99), card(99)], [card(2), card(2), card(2), card(2)]), neverGet);
        expect(result.accepted).toBe(true);
    });

    test('NEVER_GET game mixed: give 2 of it + 1 other, receive 6 of other sets → accepted', () => {
        const result = validateOffer(
            offer([card(99, 'cardborder_0', 'A'), card(99, 'cardborder_0', 'B'), card(1)], [card(2), card(2), card(2), card(2), card(3), card(3)]),
            neverGet
        );
        expect(result.accepted).toBe(true);
    });

    test('NEVER_GET game mixed: cross-set give + 1 received card of it → declined', () => {
        const result = validateOffer(offer([card(99), card(1)], [card(99), card(2), card(2)]), neverGet);
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('never_get');
    });

    test('hard blacklisted game → reason names the cards', () => {
        const config = withRules({ neverGet: ['99'] });
        const result = validateOffer(
            offer([card(1), card(1)], [card(99), card(99), card(99), card(99)]),
            config
        );
        expect(result.errorLines.some(l => l.includes('never takes') && l.includes('4× Test Card (Game99)'))).toBe(true);
    });
});

// ─── Soft-Blacklist ──────────────────────────────────────────────────────────

describe('Soft-Blacklist', () => {
    test('soft blacklisted game in cross-set receive → declined', () => {
        const config = withRules({ onlySwap: ['99'], onlyGive: ['99'] });
        const result = validateOffer(
            offer([card(1), card(1)], [card(99), card(99), card(99), card(99)]),
            config
        );
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('same_set_get');
    });

    test('soft blacklisted game in 1:1 trade → accepted (1:1 is filtered out first)', () => {
        const config = withRules(DUPES_SWAP_99, { ownedCounts: new Map([['99-Test Card', 3]]) });
        const result = validateOffer(
            offer([card(99), card(99)], [card(99), card(99)]),
            config
        );
        expect(result.accepted).toBe(true);
    });

    test('soft blacklisted game in give → declined', () => {
        const config = withRules(DUPES_SWAP_99);
        const result = validateOffer(
            offer([card(99), card(99)], [card(2), card(2), card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(false);
    });
});

// ─── Soft-Give: duplicates only ──────────────────────────────────────────────

describe('Soft-Give: duplicates only', () => {
    const soft = (owned) => withRules(DUPES_SWAP_99, { ownedCounts: owned });

    test('give duplicate 1:1 → accepted', () => {
        const result = validateOffer(
            offer([card(99, 'cardborder_0', 'A')], [card(99, 'cardborder_0', 'B')]),
            soft(new Map([['99-A', 2]]))
        );
        expect(result.accepted).toBe(true);
    });

    test('give last copy 1:1 → declined', () => {
        const result = validateOffer(
            offer([card(99, 'cardborder_0', 'A')], [card(99, 'cardborder_0', 'B')]),
            soft(new Map([['99-A', 1]]))
        );
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('last_copy');
    });

    test('give 2 of 2 copies → declined', () => {
        const result = validateOffer(
            offer([card(99, 'cardborder_0', 'A'), card(99, 'cardborder_0', 'A')], [card(99, 'cardborder_0', 'B'), card(99, 'cardborder_0', 'C')]),
            soft(new Map([['99-A', 2]]))
        );
        expect(result.accepted).toBe(false);
    });

    test('received card already owned → accepted', () => {
        const result = validateOffer(
            offer([card(99, 'cardborder_0', 'A')], [card(99, 'cardborder_0', 'B')]),
            soft(new Map([['99-A', 2], ['99-B', 5]]))
        );
        expect(result.accepted).toBe(true);
    });

    test('foil copy does not count as duplicate of normal card', () => {
        const result = validateOffer(
            offer([card(99, 'cardborder_0', 'A')], [card(99, 'cardborder_0', 'B')]),
            soft(new Map([['99-A', 1], ['99-A (Foil)', 1]]))
        );
        expect(result.accepted).toBe(false);
    });

    test('duplicate in cross-set trade → declined (only 1:1)', () => {
        const result = validateOffer(
            offer([card(99, 'cardborder_0', 'A')], [card(2), card(2)]),
            soft(new Map([['99-A', 3]]))
        );
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('same_set_give');
    });

    test('inventory not loaded → declined', () => {
        const result = validateOffer(
            offer([card(99, 'cardborder_0', 'A')], [card(99, 'cardborder_0', 'B')]),
            soft(null)
        );
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('inventory_missing');
    });

    test('no soft-give card in offer → inventory not needed', () => {
        const result = validateOffer(offer([card(1)], [card(2), card(2)]), soft(null));
        expect(result.accepted).toBe(true);
    });
});

// ─── Auto decline: clear cases vs. manual check ──────────────────────────────

describe('Auto decline', () => {
    const soft = (owned) => withRules(DUPES_SWAP_99, { ownedCounts: owned });

    test('bot gives non-card item → clear case', () => {
        const result = validateOffer(offer([nonCard(1)], [card(2), card(2)]), DEFAULT_CONFIG);
        expect(result.autoDecline).toBe(true);
    });

    test('bot receives non-card item → manual check', () => {
        const result = validateOffer(offer([card(1)], [nonCard(2), card(2), card(2)]), DEFAULT_CONFIG);
        expect(result.accepted).toBe(false);
        expect(result.autoDecline).toBe(false);
    });

    test('bot gives NEVER_GIVE card → clear case', () => {
        const config = withRules({ neverGive: ['99'] });
        const result = validateOffer(offer([card(99)], [card(2), card(2)]), config);
        expect(result.autoDecline).toBe(true);
    });

    test('bot gets NEVER_GET card → manual check', () => {
        const config = withRules({ neverGet: ['99'] });
        const result = validateOffer(offer([card(1)], [card(99), card(99)]), config);
        expect(result.accepted).toBe(false);
        expect(result.autoDecline).toBe(false);
    });

    test('last copy in pure 1 for 1 offer → clear case', () => {
        const result = validateOffer(
            offer([card(99, 'cardborder_0', 'A')], [card(99, 'cardborder_0', 'B')]),
            soft(new Map([['99-A', 1]]))
        );
        expect(result.autoDecline).toBe(true);
    });

    test('2:2, both given cards are last copies → clear case', () => {
        const result = validateOffer(
            offer(
                [card(99, 'cardborder_0', 'A'), card(99, 'cardborder_0', 'B')],
                [card(99, 'cardborder_0', 'C'), card(99, 'cardborder_0', 'D')]
            ),
            soft(new Map([['99-A', 1], ['99-B', 1]]))
        );
        expect(result.autoDecline).toBe(true);
    });

    test('3:3, all given cards are last copies, different sets → clear case', () => {
        const config = withRules({ onlySwap: ['98', '99'], duplicatesOnly: ['98', '99'] }, { ownedCounts: new Map([['99-A', 1], ['98-B', 1]]) });
        const result = validateOffer(
            offer(
                [card(99, 'cardborder_0', 'A'), card(98, 'cardborder_0', 'B'), card(98, 'cardborder_0', 'B')],
                [card(99, 'cardborder_0', 'C'), card(98, 'cardborder_0', 'D'), card(98, 'cardborder_0', 'E')]
            ),
            config
        );
        expect(result.autoDecline).toBe(true);
    });

    test('2:2, only one given card is last copy → manual check', () => {
        const result = validateOffer(
            offer(
                [card(99, 'cardborder_0', 'A'), card(99, 'cardborder_0', 'B')],
                [card(99, 'cardborder_0', 'C'), card(99, 'cardborder_0', 'D')]
            ),
            soft(new Map([['99-A', 1], ['99-B', 2]]))
        );
        expect(result.accepted).toBe(false);
        expect(result.autoDecline).toBe(false);
    });

    test('2:2, both copies of a card the bot has 2 times → manual check (1 copy may go)', () => {
        const result = validateOffer(
            offer(
                [card(99, 'cardborder_0', 'B'), card(99, 'cardborder_0', 'B')],
                [card(99, 'cardborder_0', 'C'), card(99, 'cardborder_0', 'D')]
            ),
            soft(new Map([['99-B', 2]]))
        );
        expect(result.accepted).toBe(false);
        expect(result.autoDecline).toBe(false);
    });

    test('2:3, both given cards are last copies → manual check (not N:N)', () => {
        const result = validateOffer(
            offer(
                [card(99, 'cardborder_0', 'A'), card(99, 'cardborder_0', 'B')],
                [card(99, 'cardborder_0', 'C'), card(99, 'cardborder_0', 'D'), card(99, 'cardborder_0', 'E')]
            ),
            soft(new Map([['99-A', 1], ['99-B', 1]]))
        );
        expect(result.accepted).toBe(false);
        expect(result.autoDecline).toBe(false);
    });

    test('last copy in offer with more cards → manual check', () => {
        const result = validateOffer(
            offer(
                [card(99, 'cardborder_0', 'A'), card(1)],
                [card(99, 'cardborder_0', 'B'), card(2), card(2)]
            ),
            soft(new Map([['99-A', 1]]))
        );
        expect(result.accepted).toBe(false);
        expect(result.autoDecline).toBe(false);
    });

    test('inventory not loaded → manual check', () => {
        const result = validateOffer(
            offer([card(99, 'cardborder_0', 'A')], [card(99, 'cardborder_0', 'B')]),
            soft(null)
        );
        expect(result.accepted).toBe(false);
        expect(result.autoDecline).toBe(false);
    });

    test('cross-set ratio wrong → manual check', () => {
        const result = validateOffer(offer([card(1)], [card(2)]), DEFAULT_CONFIG);
        expect(result.accepted).toBe(false);
        expect(result.autoDecline).toBe(false);
    });

    test('accepted offer → no auto decline', () => {
        const result = validateOffer(offer([card(1)], [card(2), card(2)]), DEFAULT_CONFIG);
        expect(result.autoDecline).toBe(false);
    });
});

// ─── Foil cards ──────────────────────────────────────────────────────────────

describe('Foil cards', () => {
    test('give 1 foil, receive 2 foil → accepted', () => {
        const result = validateOffer(
            offer([card(1, 'cardborder_1')], [card(2, 'cardborder_1'), card(2, 'cardborder_1')]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('mixed trade: give 1 normal + 1 foil, receive 2 each → accepted', () => {
        const result = validateOffer(
            offer(
                [card(1, 'cardborder_0'), card(1, 'cardborder_1')],
                [card(2, 'cardborder_0'), card(2, 'cardborder_0'), card(2, 'cardborder_1'), card(2, 'cardborder_1')]
            ),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('give foil, receive only normal cards → declined (foil ratio wrong)', () => {
        const result = validateOffer(
            offer([card(1, 'cardborder_1')], [card(2, 'cardborder_0'), card(2, 'cardborder_0')]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(false);
    });
});

// ─── Sale cards: special case "get" ─────────────────────────────────────────

describe('Sale cards: get (receive 1 special, give 2 normal)', () => {
    test('receive 1 sale card, give 2 normal → accepted', () => {
        const config = { ...DEFAULT_CONFIG, saleMarketFeeAppIdGet: '999' };
        const result = validateOffer(
            offer([card(1), card(1)], [card('999')]),
            config
        );
        expect(result.accepted).toBe(true);
    });

    test('receive 1 sale card, give only 1 normal → declined (too few given)', () => {
        const config = { ...DEFAULT_CONFIG, saleMarketFeeAppIdGet: '999' };
        const result = validateOffer(
            offer([card(1)], [card('999')]),
            config
        );
        expect(result.accepted).toBe(false);
    });
});

// ─── Sale cards: special case "give" ────────────────────────────────────────

describe('Sale cards: give (give 1 special, receive 3 normal)', () => {
    test('give 1 sale card, receive 3 normal → accepted', () => {
        const config = { ...DEFAULT_CONFIG, saleMarketFeeAppIdGive: ['999'] };
        const result = validateOffer(
            offer([card('999')], [card(2), card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(true);
    });

    test('give 1 sale card, receive only 2 normal → declined', () => {
        const config = {
            ...DEFAULT_CONFIG,
            saleMarketFeeAppIdGet: 'nonexistent',
            saleMarketFeeAppIdGive: ['999']
        };
        const result = validateOffer(
            offer([card('999')], [card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('sale_give');
    });

    test('give rule works without get rule: 1 sale card for 2 → declined', () => {
        const config = { ...DEFAULT_CONFIG, saleMarketFeeAppIdGive: ['999'] };
        const result = validateOffer(
            offer([card('999')], [card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('sale_give');
    });

    test('give 2 sale cards, receive 6 normal → accepted', () => {
        const config = { ...DEFAULT_CONFIG, saleMarketFeeAppIdGive: ['999'] };
        const result = validateOffer(
            offer([card('999'), card('999')], [card(2), card(2), card(2), card(2), card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(true);
    });
});

describe('Regressions', () => {
    test('non-trading card → errorLines is set', () => {
        const result = validateOffer(offer([], [nonCard(1)]), DEFAULT_CONFIG);
        expect(result.accepted).toBe(false);
        expect(codes(result)).toContain('non_card_get');
    });

    test('give 2 sale cards, receive 6 normal, sale get set → accepted', () => {
        const config = { ...DEFAULT_CONFIG, saleMarketFeeAppIdGet: '555', saleMarketFeeAppIdGive: ['999'] };
        const result = validateOffer(
            offer([card('999'), card('999')], [card(2), card(2), card(2), card(2), card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(true);
    });

    test('give card with unknown border → declined', () => {
        const result = validateOffer(offer([card(1, null)], [card(2), card(2)]), DEFAULT_CONFIG);
        expect(result.accepted).toBe(false);
    });
});

// ─── Mapper: mapSteamOffer ────────────────────────────────────────────────────

describe('mapSteamOffer', () => {
    // Creates a simulated Steam item object (as the library returns it)
    function steamItem(appId, name, border = 'cardborder_0') {
        return {
            market_fee_app: appId,
            name: name,
            market_name: `Game${appId} - ${name}`,
            type: `Game${appId} Trading Card`,
            tags: [
                { category: 'Trading Card', name: 'Trading Card', internal_name: 'trading_card' },
                { category: 'cardborder', name: border === 'cardborder_0' ? 'Normal' : 'Foil', internal_name: border }
            ]
        };
    }

    test('Steam item maps correctly to TradeItem', () => {
        const item = mapSteamItem(steamItem(420, 'Companion Cube'));
        expect(item.appId).toBe('420');
        expect(item.name).toBe('Companion Cube');
        expect(item.border).toBe('cardborder_0');
        expect(item.isTradingCard).toBe(true);
    });

    test('foil card is detected correctly', () => {
        const item = mapSteamItem(steamItem(420, 'Companion Cube Foil', 'cardborder_1'));
        expect(item.border).toBe('cardborder_1');
        expect(item.isTradingCard).toBe(true);
    });

    test('Steam offer maps completely', () => {
        const steamOffer = {
            id: 'offer-123',
            itemsToReceive: [steamItem(1, 'Card A')],
            itemsToGive: [steamItem(2, 'Card B')]
        };
        const mapped = mapSteamOffer(steamOffer);
        expect(mapped.id).toBe('offer-123');
        expect(mapped.itemsToReceive).toHaveLength(1);
        expect(mapped.itemsToGive).toHaveLength(1);
        expect(mapped.itemsToReceive[0]).toBeInstanceOf(TradeItem);
    });
});

// ─── All reasons are collected ───────────────────────────────────────────────

describe('All decline reasons', () => {
    test('checks go on after a non-card item and list all reasons', () => {
        const config = withRules({ neverGive: ['99'] });
        const result = validateOffer(
            offer([nonCard(5), card(99, 'cardborder_0', 'Locked'), card(1, 'cardborder_0', 'X')], [card(2)]),
            config
        );
        expect(result.accepted).toBe(false);
        expect(codes(result)).toEqual(['non_card_give', 'never_give', 'ratio']);
    });

    test('reasons name the cards', () => {
        const result = validateOffer(
            offer([card(1, 'cardborder_1', 'Shiny')], [card(2, 'cardborder_1', 'Other')]),
            DEFAULT_CONFIG
        );
        const line = result.errorLines.find(l => l.includes('foil'));
        expect(line).toContain('Shiny (Game1, Foil)');
        expect(line).toContain('Other (Game2, Foil)');
    });

    test('normal and foil ratio errors are both listed', () => {
        const result = validateOffer(
            offer([card(1, 'cardborder_0'), card(1, 'cardborder_1')], [card(2, 'cardborder_0'), card(2, 'cardborder_1')]),
            DEFAULT_CONFIG
        );
        expect(codes(result)).toEqual(['ratio', 'ratio']);
    });

    test('failed sale card is not counted again in the ratio check', () => {
        const config = { ...DEFAULT_CONFIG, saleMarketFeeAppIdGive: ['999'] };
        const result = validateOffer(offer([card('999')], [card(2), card(2)]), config);
        expect(codes(result)).toEqual(['sale_give']);
    });

    test('accepted offer has no reasons', () => {
        const result = validateOffer(offer([card(1)], [card(2), card(2)]), DEFAULT_CONFIG);
        expect(result.reasons).toEqual([]);
        expect(result.errorLines).toEqual([]);
    });
});

// ─── Set rules: combinations ─────────────────────────────────────────────────

describe('Set rules', () => {
    test('blocked set: 1:1 swap → declined', () => {
        const result = validateOffer(offer([card(99)], [card(99)]), withRules({ blocked: ['99'] }));
        expect(codes(result)).toEqual(['never_give', 'never_get']);
        expect(result.autoDecline).toBe(true);
    });

    test('blocked set: give 1, get 2 of other set → declined', () => {
        const result = validateOffer(offer([card(99)], [card(2), card(2)]), withRules({ blocked: ['99'] }));
        expect(codes(result)).toContain('never_give');
    });

    test('blocked set: get 2, give 1 of other set → declined', () => {
        const result = validateOffer(offer([card(1)], [card(99), card(99)]), withRules({ blocked: ['99'] }));
        expect(codes(result)).toContain('never_get');
    });

    test('never give: get 2 for 1 of other set → accepted', () => {
        const result = validateOffer(offer([card(1)], [card(99), card(99)]), withRules({ neverGive: ['99'] }));
        expect(result.accepted).toBe(true);
    });

    test('never give: 1:1 swap → declined', () => {
        const result = validateOffer(offer([card(99)], [card(99)]), withRules({ neverGive: ['99'] }));
        expect(codes(result)).toContain('never_give');
    });

    describe('only same-set swap', () => {
        const rules = withRules({ onlySwap: ['99'] });

        test('2:2 → accepted', () => {
            const result = validateOffer(offer([card(99), card(99)], [card(99), card(99)]), rules);
            expect(result.accepted).toBe(true);
        });

        test('give 1, get 2 of other set → declined', () => {
            const result = validateOffer(offer([card(99)], [card(2), card(2)]), rules);
            expect(codes(result)).toEqual(['same_set_give']);
        });

        test('get 2, give 1 of other set → declined', () => {
            const result = validateOffer(offer([card(1)], [card(99), card(99)]), rules);
            expect(codes(result)).toContain('same_set_get');
        });
    });

    describe('only give 1 for 2', () => {
        const rules = withRules({ onlyGive: ['99'] });

        test('give 1, get 2 of other set → accepted', () => {
            const result = validateOffer(offer([card(99)], [card(2), card(2)]), rules);
            expect(result.accepted).toBe(true);
        });

        test('1:1 swap → declined', () => {
            const result = validateOffer(offer([card(99)], [card(99)]), rules);
            expect(codes(result)).toContain('never_get');
        });
    });

    describe('only get cross-set', () => {
        const rules = withRules({ onlyGet: ['99'] });

        test('get 1 of it + 1 of other set, give 1 of third set → accepted', () => {
            const result = validateOffer(offer([card(1)], [card(99), card(2)]), rules);
            expect(result.accepted).toBe(true);
        });

        test('same with only swap: get 1 of it + 1 of other set for 1 → accepted', () => {
            const result = validateOffer(offer([card(1)], [card(99), card(2)]), withRules({ onlyGet: ['99'], onlySwap: ['99'] }));
            expect(result.accepted).toBe(true);
        });

        test('get 2, give 1 of other set → accepted', () => {
            const result = validateOffer(offer([card(1)], [card(99), card(99)]), rules);
            expect(result.accepted).toBe(true);
        });

        test('give 1, get 2 of other set → declined', () => {
            const result = validateOffer(offer([card(99)], [card(2), card(2)]), rules);
            expect(codes(result)).toContain('never_give');
        });
    });

    describe('only swap + only give 1 for 2 (count of the set does not grow)', () => {
        const rules = withRules({ onlySwap: ['99'], onlyGive: ['99'] });

        test('1:1 swap → accepted', () => {
            const result = validateOffer(offer([card(99)], [card(99)]), rules);
            expect(result.accepted).toBe(true);
        });

        test('give 2, get 4 of other set → accepted', () => {
            const result = validateOffer(offer([card(99), card(99)], [card(2), card(2), card(2), card(2)]), rules);
            expect(result.accepted).toBe(true);
        });

        test('mixed: 1:1 swap + give 1 for 2 → accepted', () => {
            const result = validateOffer(offer([card(99), card(99)], [card(99), card(2), card(2)]), rules);
            expect(result.accepted).toBe(true);
        });

        test('get 2, give 1 of other set → declined', () => {
            const result = validateOffer(offer([card(1)], [card(99), card(99)]), rules);
            expect(codes(result)).toContain('same_set_get');
        });

        test('give 1, get 2 of same set → declined', () => {
            const result = validateOffer(offer([card(99)], [card(99), card(99)]), rules);
            expect(codes(result)).toContain('same_set_get');
        });
    });

    describe('only swap + only duplicates + only get cross-set', () => {
        const rules = (owned) => withRules({ onlySwap: ['99'], onlyGet: ['99'], duplicatesOnly: ['99'] }, { ownedCounts: owned });

        test('swap a duplicate 1:1 → accepted', () => {
            const result = validateOffer(offer([card(99, 'cardborder_0', 'A')], [card(99, 'cardborder_0', 'B')]), rules(new Map([['99-A', 2]])));
            expect(result.accepted).toBe(true);
        });

        test('get 2, give 1 of other set → accepted', () => {
            const result = validateOffer(offer([card(1)], [card(99), card(99)]), rules(new Map()));
            expect(result.accepted).toBe(true);
        });

        test('give a duplicate for 2 of other set → declined', () => {
            const result = validateOffer(offer([card(99, 'cardborder_0', 'A')], [card(2), card(2)]), rules(new Map([['99-A', 3]])));
            expect(codes(result)).toContain('same_set_give');
        });
    });

    test('only give 1 for 2 + duplicates: last copy → declined', () => {
        const config = withRules({ onlyGive: ['99'], duplicatesOnly: ['99'] }, { ownedCounts: new Map([['99-A', 1]]) });
        const result = validateOffer(offer([card(99, 'cardborder_0', 'A')], [card(2), card(2)]), config);
        expect(codes(result)).toEqual(['last_copy']);
    });

    test('neverGiveIds lists sets the bot cannot give at all', () => {
        const rules = buildSetRules({ blocked: ['1'], neverGive: ['2'], onlyGet: ['3'], onlySwap: ['4'], duplicatesOnly: ['5'] });
        expect(rules.neverGiveIds().sort()).toEqual(['1', '2', '3']);
    });
});
