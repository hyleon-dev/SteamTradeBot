// Protects duplicates of soft-give games against parallel offers.
// Cards of an accepted offer stay reserved until the trade is done.
// Without this, two offers can each see 2 copies and both take one.

// Runs tasks one after the other. A failed task does not block the next one.
function createLock() {
    let tail = Promise.resolve();
    return function runExclusive(task) {
        const result = tail.then(task);
        tail = result.catch(() => {});
        return result;
    };
}

class CardReservations {
    constructor() {
        this.byOffer = new Map(); // offerId -> Map market_hash_name -> count
    }

    // Reserve the given cards for an offer.
    reserve(offerId, items) {
        if (items.length === 0) return;
        const counts = new Map();
        items.forEach(item => counts.set(item.market_hash_name, (counts.get(item.market_hash_name) || 0) + 1));
        this.byOffer.set(String(offerId), counts);
    }

    release(offerId) {
        return this.byOffer.delete(String(offerId));
    }

    has(offerId) {
        return this.byOffer.has(String(offerId));
    }

    // Returns a copy of ownedCounts minus all reserved cards. null stays null.
    apply(ownedCounts) {
        if (!ownedCounts) return null;
        const result = new Map(ownedCounts);
        this.byOffer.forEach(counts => {
            counts.forEach((count, name) => result.set(name, (result.get(name) || 0) - count));
        });
        return result;
    }
}

module.exports = { createLock, CardReservations };
