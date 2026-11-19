const { codesFromTexts } = require('./reasons');

describe('codesFromTexts', () => {
    test('maps old texts', () => {
        expect(codesFromTexts([
            '🔴 Cross trading does not add up',
            '🔴 Trade contains hard blacklisted game',
            '🔴 Found something other than a trading card in trade.',
        ])).toEqual(['ratio', 'never_list', 'non_card']);
    });

    test('maps new texts and removes duplicates', () => {
        expect(codesFromTexts([
            '🔴 Cross-set trade needs 2 normal cards for each normal card. ...',
            '🔴 Cross-set trade needs 2 foil cards for each foil card. ...',
            '🔴 Bot would give its last copy of protected cards: A',
        ])).toEqual(['ratio', 'last_copy']);
    });

    test('skips lines that are no reasons, unknown reasons get other', () => {
        expect(codesFromTexts(['🚫 Declined automatically (clear case)', '🔴 Something new'])).toEqual(['other']);
        expect(codesFromTexts(null)).toEqual([]);
    });
});
