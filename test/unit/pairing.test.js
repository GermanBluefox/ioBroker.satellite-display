'use strict';

// Pairing of a tablet (lib/pairing.js): one-time codes, and the row a tablet enters for itself.

const assert = require('node:assert/strict');
const { PairingCodes, pairedRow, cleanName, namesOf, PAIR_MS, MAX_CODES, NAME_MAX } = require('../../lib/pairing');
const { TABLET_DEFAULT, normalizeTablets } = require('../../lib/layout');

describe('pairing: codes', () => {
    it('are valid once', () => {
        const codes = new PairingCodes();
        const { code, expires } = codes.open();
        assert.ok(code.length >= 24, code);
        assert.ok(expires > Date.now());
        assert.notEqual(codes.open().code, code);
        assert.equal(codes.take('wrong'), false);
        assert.equal(codes.take(undefined), false);
        assert.equal(codes.take(code), true);
        assert.equal(codes.take(code), false, 'a used code');
    });

    it('expire after their time', () => {
        let now = 1_000_000;
        const codes = new PairingCodes(() => now);
        const { code, expires } = codes.open();
        assert.equal(expires, now + PAIR_MS);
        now += PAIR_MS;
        assert.equal(codes.take(code), false);
    });

    it('keep the newest ones when many are opened', () => {
        const codes = new PairingCodes();
        const opened = Array.from({ length: MAX_CODES + 2 }, () => codes.open().code);
        assert.equal(codes.take(opened[0]), false, 'the oldest went');
        assert.equal(codes.take(opened[1]), false);
        assert.equal(codes.take(opened[opened.length - 1]), true);
        assert.equal(codes.take(opened[2]), true);
    });
});

describe('pairing: the row of a tablet', () => {
    it('takes name and screen size, in whole CSS pixels within the limits of the table', () => {
        const row = pairedRow({ name: '  Tab Active5 Pro\nvon Denis ', width: 1280.4, height: '800' }, []);
        assert.deepEqual(row, {
            enabled: true,
            name: 'Tab Active5 Pro von Denis',
            width: 1280,
            height: 800,
            cols: TABLET_DEFAULT.cols,
            rows: TABLET_DEFAULT.rows,
            pages: TABLET_DEFAULT.pages,
            lockEnabled: false,
            pin: '',
        });
        const huge = pairedRow({ name: 'x', width: 1e9, height: 5 }, []);
        assert.deepEqual([huge.width, huge.height], [10000, 100]);
    });

    it('turns the grid of an upright screen', () => {
        const row = pairedRow({ name: 'Flur', width: 800, height: 1280 }, []);
        assert.deepEqual([row.cols, row.rows], [TABLET_DEFAULT.rows, TABLET_DEFAULT.cols]);
    });

    it('leaves the size out when the tablet sends none (the editor takes 4:3 then)', () => {
        const row = pairedRow({ name: 'Flur', width: 'wide' }, []);
        assert.equal('width' in row, false);
        assert.equal('height' in row, false);
        assert.deepEqual([row.cols, row.rows], [TABLET_DEFAULT.cols, TABLET_DEFAULT.rows]);
    });

    it('numbers a name a satellite or a tablet already has, as the settings compare them', () => {
        const taken = ['Küche', 'Flur', 'flur 2'];
        assert.equal(pairedRow({ name: 'FLUR' }, taken).name, 'FLUR 3');
        assert.equal(pairedRow({ name: 'Bad' }, taken).name, 'Bad');
        // the row passes the check of the settings next to the ones it was compared with
        const rows = [...taken.map(name => ({ name })), pairedRow({ name: 'flur' }, taken)];
        const problems = [];
        assert.equal(normalizeTablets(rows, [], problems).length, 4, problems.join('\n'));
    });

    it('cleans a name: one line, no control characters, not too long, never empty', () => {
        assert.equal(cleanName('a\u0000b\tc'), 'a b c');
        assert.equal(cleanName('   '), 'Tablet');
        assert.equal(cleanName(null), 'Tablet');
        assert.equal(Array.from(cleanName('ü'.repeat(100))).length, NAME_MAX);
    });

    it('namesOf reads both tables, also as an object of rows, and skips rows without a name', () => {
        assert.deepEqual(
            namesOf({
                satellites: [{ name: 'Gast' }, { name: '' }],
                tablets: { 0: { name: 'Flur', enabled: false }, 1: null },
            }),
            ['Gast', 'Flur'],
        );
        assert.deepEqual(namesOf({}), []);
    });
});
