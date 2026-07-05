const { TradeItem, TradeOffer, validateOffer, mapSteamItem, mapSteamOffer } = require('./utils');

// Standardkonfiguration ohne Blacklists und ohne Sale-Karten
const DEFAULT_CONFIG = {
    hardBlacklist: { get: [], give: [] },
    softBlacklist: { get: [], give: [] },
    saleMarketFeeAppIdGet: null,
    saleMarketFeeAppIdGive: []
};

// Erstellt eine normale Trading Card als TradeItem
function card(appId, border = 'cardborder_0', name = 'Test Card') {
    return new TradeItem({
        appId: String(appId),
        name: name,
        type: `Game${appId} Trading Card`,
        border,
        isTradingCard: true
    });
}

// Erstellt ein Item, das KEINE Trading Card ist
function nonCard(appId) {
    return new TradeItem({
        appId: String(appId),
        name: 'Some Item',
        type: 'Some Item Type',
        border: 'cardborder_0',
        isTradingCard: false
    });
}

// Erstellt ein TradeOffer-Objekt
function offer(give, receive) {
    return new TradeOffer({ id: 'test-offer', itemsToGive: give, itemsToReceive: receive });
}

// ─── Cross-Set-Trades ────────────────────────────────────────────────────────

describe('Cross-Set-Trades', () => {
    test('1 abgeben, 2 erhalten → angenommen', () => {
        const result = validateOffer(
            offer([card(1)], [card(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('2 abgeben, 4 erhalten → angenommen', () => {
        const result = validateOffer(
            offer([card(1), card(1)], [card(2), card(2), card(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('1 abgeben, 3 erhalten → angenommen (mehr ist ok)', () => {
        const result = validateOffer(
            offer([card(1)], [card(2), card(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('2 abgeben, 3 erhalten → abgelehnt (Ratio zu niedrig)', () => {
        const result = validateOffer(
            offer([card(1), card(1)], [card(2), card(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(false);
        expect(result.errorLines).toContain('🔴 Cross trading does not add up');
    });

    test('1 abgeben, 1 erhalten (unterschiedliche Spiele) → abgelehnt', () => {
        const result = validateOffer(
            offer([card(1)], [card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(false);
    });
});

// ─── 1:1 Same-Game-Trades ────────────────────────────────────────────────────

describe('1:1 Same-Game-Trades', () => {
    test('2:2 gleiches Spiel → angenommen', () => {
        const result = validateOffer(
            offer([card(1), card(1)], [card(1), card(1)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('1:1 gleiches Spiel + 1:2 Cross-Set → angenommen', () => {
        // Spiel 1 wird als 1:1 herausgefiltert, Spiel 2 (give) gegen Spiel 3 (receive) bleibt als 1:2
        const result = validateOffer(
            offer([card(1), card(2)], [card(1), card(3), card(3)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });
});

// ─── Non-Trading-Card-Items ──────────────────────────────────────────────────

describe('Non-Trading-Card-Items', () => {
    test('kein Trading Card in receive → abgelehnt', () => {
        const result = validateOffer(
            offer([card(1)], [nonCard(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(false);
    });

    test('kein Trading Card in give → abgelehnt', () => {
        const result = validateOffer(
            offer([nonCard(1), card(1)], [card(2), card(2)]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(false);
    });
});

// ─── Hard-Blacklist ──────────────────────────────────────────────────────────

describe('Hard-Blacklist', () => {
    test('hard blacklisted Spiel in receive → abgelehnt', () => {
        const config = { ...DEFAULT_CONFIG, hardBlacklist: { get: ['99'], give: [] } };
        const result = validateOffer(
            offer([card(1), card(1)], [card(99), card(99), card(99), card(99)]),
            config
        );
        expect(result.accepted).toBe(false);
        expect(result.errorLines).toContain('🔴 Trade contains hard blacklisted game');
    });

    test('hard blacklisted Spiel in give → abgelehnt', () => {
        const config = { ...DEFAULT_CONFIG, hardBlacklist: { get: [], give: ['99'] } };
        const result = validateOffer(
            offer([card(99), card(99)], [card(2), card(2), card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(false);
        expect(result.errorLines).toContain('🔴 Trade contains hard blacklisted game');
    });

    test('hard blacklisted Spiel → Discord-Warnung enthält Spielnamen', () => {
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
    test('soft blacklisted Spiel in Cross-Set-receive → abgelehnt', () => {
        const config = { ...DEFAULT_CONFIG, softBlacklist: { get: ['99'], give: [] } };
        const result = validateOffer(
            offer([card(1), card(1)], [card(99), card(99), card(99), card(99)]),
            config
        );
        expect(result.accepted).toBe(false);
        expect(result.errorLines).toContain('🔴 Cross trading contains soft blacklisted game');
    });

    test('soft blacklisted Spiel in 1:1-Trade → angenommen (1:1 wird zuerst herausgefiltert)', () => {
        const config = { ...DEFAULT_CONFIG, softBlacklist: { get: ['99'], give: ['99'] } };
        const result = validateOffer(
            offer([card(99), card(99)], [card(99), card(99)]),
            config
        );
        expect(result.accepted).toBe(true);
    });

    test('soft blacklisted Spiel in give → abgelehnt', () => {
        const config = { ...DEFAULT_CONFIG, softBlacklist: { get: [], give: ['99'] } };
        const result = validateOffer(
            offer([card(99), card(99)], [card(2), card(2), card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(false);
    });
});

// ─── Foil-Karten ─────────────────────────────────────────────────────────────

describe('Foil-Karten', () => {
    test('1 Foil abgeben, 2 Foil erhalten → angenommen', () => {
        const result = validateOffer(
            offer([card(1, 'cardborder_1')], [card(2, 'cardborder_1'), card(2, 'cardborder_1')]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('gemischter Trade: 1 normal + 1 foil abgeben, je 2 erhalten → angenommen', () => {
        const result = validateOffer(
            offer(
                [card(1, 'cardborder_0'), card(1, 'cardborder_1')],
                [card(2, 'cardborder_0'), card(2, 'cardborder_0'), card(2, 'cardborder_1'), card(2, 'cardborder_1')]
            ),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(true);
    });

    test('Foil abgeben, nur normale Karten erhalten → abgelehnt (Foil-Ratio stimmt nicht)', () => {
        const result = validateOffer(
            offer([card(1, 'cardborder_1')], [card(2, 'cardborder_0'), card(2, 'cardborder_0')]),
            DEFAULT_CONFIG
        );
        expect(result.accepted).toBe(false);
    });
});

// ─── Sale-Karten: Sonderfall "get" ───────────────────────────────────────────

describe('Sale-Karten: get (1 Special erhalten, 2 normale abgeben)', () => {
    test('1 Sale-Karte erhalten, 2 normale abgeben → angenommen', () => {
        const config = { ...DEFAULT_CONFIG, saleMarketFeeAppIdGet: '999' };
        const result = validateOffer(
            offer([card(1), card(1)], [card('999')]),
            config
        );
        expect(result.accepted).toBe(true);
    });

    test('1 Sale-Karte erhalten, nur 1 normale abgeben → abgelehnt (zu wenig abgegeben)', () => {
        const config = { ...DEFAULT_CONFIG, saleMarketFeeAppIdGet: '999' };
        const result = validateOffer(
            offer([card(1)], [card('999')]),
            config
        );
        expect(result.accepted).toBe(false);
    });
});

// ─── Sale-Karten: Sonderfall "give" ──────────────────────────────────────────

describe('Sale-Karten: give (1 Special abgeben, 3 normale erhalten)', () => {
    test('1 Sale-Karte abgeben, 3 normale erhalten → angenommen', () => {
        const config = { ...DEFAULT_CONFIG, saleMarketFeeAppIdGive: ['999'] };
        const result = validateOffer(
            offer([card('999')], [card(2), card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(true);
    });

    test('1 Sale-Karte abgeben, nur 2 normale erhalten → abgelehnt', () => {
        // saleMarketFeeAppIdGet muss gesetzt sein damit der Sale-Karten-Block überhaupt läuft
        // (Original-Verhalten: beide Sale-Prüfungen sind im selben if-Block)
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

    test('2 Sale-Karten abgeben, 6 normale erhalten → angenommen', () => {
        const config = { ...DEFAULT_CONFIG, saleMarketFeeAppIdGive: ['999'] };
        const result = validateOffer(
            offer([card('999'), card('999')], [card(2), card(2), card(2), card(2), card(2), card(2)]),
            config
        );
        expect(result.accepted).toBe(true);
    });
});

// ─── Mapper: mapSteamOffer ────────────────────────────────────────────────────

describe('mapSteamOffer', () => {
    // Erstellt ein simuliertes Steam-Item-Objekt (wie es von der Library kommt)
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

    test('Steam-Item wird korrekt auf TradeItem gemappt', () => {
        const item = mapSteamItem(steamItem(420, 'Companion Cube'));
        expect(item.appId).toBe('420');
        expect(item.name).toBe('Companion Cube');
        expect(item.border).toBe('cardborder_0');
        expect(item.isTradingCard).toBe(true);
    });

    test('Foil-Karte wird korrekt erkannt', () => {
        const item = mapSteamItem(steamItem(420, 'Companion Cube Foil', 'cardborder_1'));
        expect(item.border).toBe('cardborder_1');
        expect(item.isTradingCard).toBe(true);
    });

    test('Steam-Offer wird vollständig gemappt', () => {
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
