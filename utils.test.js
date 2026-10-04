const { TradeItem, TradeOffer, validateOffer, mapSteamItem, mapSteamOffer } = require('./utils');

// Default config without blacklists and without sale cards
const DEFAULT_CONFIG = {
    hardBlacklist: { get: [], give: [] },
    softBlacklist: { get: [], give: [] },
    saleMarketFeeAppIdGet: null,
    saleMarketFeeAppIdGive: []
};

// Creates a normal trading card as TradeItem
function card(appId, border = 'cardborder_0', name = 'Test Card') {
    return new TradeItem({
        appId: String(appId),
        name: name,
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
        expect(result.errorLines).toContain('🔴 Cross trading does not add up');
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
        const config = { ...DEFAULT_CONFIG, hardBlacklist: { get: ['99'], give: [] } };
        const result = validateOffer(
            offer([card(1), card(1)], [card(99), card(99), card(99), card(99)]),
            config
        );
        expect(result.accepted).toBe(false);
        expect(result.errorLines).toContain('🔴 Trade contains hard blacklisted game');
    });

    test('hard blacklisted game in give → declined', () => {
        const config = { ...DEFAULT_CONFIG, hardBlacklist: { get: [], give: ['99'] } };
        const result = validateOffer(
            offer([card(99), card(99)], [card(2), card(2), card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(false);
        expect(result.errorLines).toContain('🔴 Trade contains hard blacklisted game');
    });

    test('hard blacklisted game → Discord warning contains game name', () => {
        const config = { ...DEFAULT_CONFIG, hardBlacklist: { get: ['99'], give: [] } };
        const result = validateOffer(
            offer([card(1), card(1)], [card(99), card(99), card(99), card(99)]),
            config
        );
        expect(result.discordLines.some(l => l.includes('Hard blacklisted'))).toBe(true);
    });
});

// ─── Soft-Blacklist ──────────────────────────────────────────────────────────

describe('Soft-Blacklist', () => {
    test('soft blacklisted game in cross-set receive → declined', () => {
        const config = { ...DEFAULT_CONFIG, softBlacklist: { get: ['99'], give: [] } };
        const result = validateOffer(
            offer([card(1), card(1)], [card(99), card(99), card(99), card(99)]),
            config
        );
        expect(result.accepted).toBe(false);
        expect(result.errorLines).toContain('🔴 Cross trading contains soft blacklisted game');
    });

    test('soft blacklisted game in 1:1 trade → accepted (1:1 is filtered out first)', () => {
        const config = { ...DEFAULT_CONFIG, softBlacklist: { get: ['99'], give: ['99'] } };
        const result = validateOffer(
            offer([card(99), card(99)], [card(99), card(99)]),
            config
        );
        expect(result.accepted).toBe(true);
    });

    test('soft blacklisted game in give → declined', () => {
        const config = { ...DEFAULT_CONFIG, softBlacklist: { get: [], give: ['99'] } };
        const result = validateOffer(
            offer([card(99), card(99)], [card(2), card(2), card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(false);
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
        // saleMarketFeeAppIdGet must be set, else the sale card block does not run
        // (original behavior: both sale checks are in the same if block)
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
        expect(result.errorLines).toContain('🔴 Found error within sale card trading');
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
        expect(result.errorLines).toContain('🔴 Found something other than a trading card in trade.');
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
