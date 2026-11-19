const { createLock, CardReservations } = require('./reservations');

const item = (name) => ({ market_hash_name: name });

describe('CardReservations', () => {
    test('apply subtracts reserved cards', () => {
        const r = new CardReservations();
        r.reserve('1', [item('99-A'), item('99-A'), item('99-B')]);
        const result = r.apply(new Map([['99-A', 3], ['99-B', 1]]));
        expect(result.get('99-A')).toBe(1);
        expect(result.get('99-B')).toBe(0);
    });

    test('apply does not change the input map', () => {
        const r = new CardReservations();
        r.reserve('1', [item('99-A')]);
        const owned = new Map([['99-A', 2]]);
        r.apply(owned);
        expect(owned.get('99-A')).toBe(2);
    });

    test('release removes the reservation', () => {
        const r = new CardReservations();
        r.reserve(1, [item('99-A')]);
        expect(r.release('1')).toBe(true);
        expect(r.apply(new Map([['99-A', 2]])).get('99-A')).toBe(2);
    });

    test('null inventory stays null', () => {
        expect(new CardReservations().apply(null)).toBeNull();
    });
});

describe('createLock', () => {
    test('runs tasks one after the other', async () => {
        const run = createLock();
        const order = [];
        const slow = run(async () => {
            await new Promise(r => setTimeout(r, 20));
            order.push('slow');
        });
        const fast = run(async () => order.push('fast'));
        await Promise.all([slow, fast]);
        expect(order).toEqual(['slow', 'fast']);
    });

    test('failed task does not block the next task', async () => {
        const run = createLock();
        await expect(run(async () => { throw new Error('x'); })).rejects.toThrow('x');
        await expect(run(async () => 'ok')).resolves.toBe('ok');
    });
});
