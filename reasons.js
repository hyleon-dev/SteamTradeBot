// Decline reason codes. utils.validateOffer sets them. The web UI shows statistics per code.

// Old trades have only reason texts. These patterns give them a code.
// Order matters: the first match wins.
const TEXT_PATTERNS = [
    // Texts since the reasons name the cards
    [/^🔴 Bot would give items that are not trading cards/, 'non_card_give'],
    [/^🔴 Bot would get items that are not trading cards/, 'non_card_get'],
    [/^🔴 Bot inventory could not be loaded/, 'inventory_missing'],
    [/^🔴 Bot would give its last copy/, 'last_copy'],
    [/^🔴 Bot would give cards of games it never gives/, 'never_give'],
    [/^🔴 Bot would get cards of games it never takes/, 'never_get'],
    [/^🔴 Bot gives these cards only in same-set swaps/, 'same_set_give'],
    [/^🔴 Bot gets these cards only in same-set swaps/, 'same_set_get'],
    [/^🔴 Bot gives these protected cards only 1:1/, 'same_set_give'],
    [/^🔴 Bot takes these cards only 1:1/, 'same_set_get'],
    [/^🔴 Bot gives sale cards only for 3/, 'sale_give'],
    [/^🔴 Bot cannot tell if these cards are normal or foil/, 'unknown_type'],
    [/^🔴 Cross-set trade needs 2/, 'ratio'],
    // Old texts. Some do not tell the direction (give or get).
    [/^🔴 Found something other than a trading card/, 'non_card'],
    [/^🔴 Cross trading does not add up/, 'ratio'],
    [/^🔴 Found error within sale card trading/, 'sale_give'],
    [/^🔴 Trade contains hard blacklisted game/, 'never_list'],
    [/^🔴 Cross trading contains soft blacklisted game/, 'same_set'],
    [/^🔴 Could not check duplicates of soft blacklisted game/, 'inventory_missing'],
    [/^🔴 Trade gives last copy of a soft blacklisted card/, 'last_copy'],
];

// Returns the unique codes of a reason text list. Unknown texts get 'other'.
// Lines without 🔴 (e.g. "🚫 Declined automatically") are no reasons.
function codesFromTexts(lines) {
    const codes = new Set();
    (lines || []).forEach(line => {
        if (!String(line).startsWith('🔴')) return;
        const match = TEXT_PATTERNS.find(([pattern]) => pattern.test(line));
        codes.add(match ? match[1] : 'other');
    });
    return Array.from(codes);
}

module.exports = { codesFromTexts };
