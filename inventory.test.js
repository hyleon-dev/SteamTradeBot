const { groupCardsBySet, parseSetSize } = require('./inventory');

// Simulated inventory item (as steam-tradeoffer-manager returns it)
function invItem(appId, name, { foil = false, tradable = true, card = true } = {}) {
    return {
        market_fee_app: appId,
        name,
        market_hash_name: `${appId}-${name}${foil ? ' (Foil)' : ''}`,
        type: card ? `Game${appId} ${foil ? 'Foil ' : ''}Trading Card` : 'Profile Background',
        icon_url_large: 'img',
        tradable,
        tags: [
            ...(card ? [{ category: 'item_class', name: 'Trading Card' }] : []),
            { category: 'cardborder', internal_name: foil ? 'cardborder_1' : 'cardborder_0' },
        ],
    };
}

describe('groupCardsBySet', () => {
    test('groups by app and foil, counts duplicates', () => {
        const sets = groupCardsBySet([
            invItem(1, 'A'), invItem(1, 'A'), invItem(1, 'B'),
            invItem(1, 'A', { foil: true }),
            invItem(2, 'C'),
        ]);
        expect(sets).toHaveLength(3);
        const normal = sets.find(s => s.appId === '1' && !s.foil);
        expect(normal.game).toBe('Game1');
        expect(normal.distinct).toBe(2);
        expect(normal.total).toBe(3);
        expect(normal.duplicates).toBe(1);
        expect(normal.cards.find(c => c.name === 'A').count).toBe(2);
        expect(sets.find(s => s.appId === '1' && s.foil).duplicates).toBe(0);
    });

    test('skips items that are not trading cards', () => {
        expect(groupCardsBySet([invItem(1, 'Bg', { card: false })])).toEqual([]);
    });

    test('counts tradable copies', () => {
        const [set] = groupCardsBySet([invItem(1, 'A'), invItem(1, 'A', { tradable: false })]);
        expect(set.cards[0]).toMatchObject({ count: 2, tradable: 1 });
    });

    test('marks protection from the rules', () => {
        const sets = groupCardsBySet([invItem(1, 'A'), invItem(2, 'B'), invItem(3, 'C')],
            { neverGive: ['1'], duplicatesOnly: ['2'] });
        expect(sets.map(s => s.protection)).toEqual(['never_give', 'duplicates_only', null]);
    });
});

describe('parseSetSize', () => {
    test('counts owned and unowned cards of the badge page', () => {
        const html = '<div class="badge_card_set_card owned">..</div>'
            + '<div class="badge_card_set_card unowned">..</div>'
            + '<div class="badge_card_set_card">..</div>'
            + '<div class="badge_card_set_cards">container</div>';
        expect(parseSetSize(html)).toBe(3);
    });

    test('returns null without cards', () => {
        expect(parseSetSize('<html>private profile</html>')).toBeNull();
        expect(parseSetSize(null)).toBeNull();
    });
});
