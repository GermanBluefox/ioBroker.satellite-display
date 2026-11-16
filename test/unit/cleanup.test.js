'use strict';

// Removed objects keep the settings of other adapters (common.custom): such a state and the folders above it stay
// (review of PR 7136, 2026-11-16).

const assert = require('node:assert/strict');
const { hasCustom, planRemoval } = require('../../lib/cleanup');

const obj = (custom = undefined) => /** @type {any} */ ({ common: custom === undefined ? {} : { custom } });

describe('cleanup', () => {
    it('custom settings count only when one is set', () => {
        assert.equal(hasCustom(obj()), false);
        assert.equal(hasCustom(obj({})), false);
        assert.equal(hasCustom(obj({ 'history.0': null })), false);
        assert.equal(hasCustom(obj({ 'influxdb.0': { enabled: true } })), true);
        assert.equal(hasCustom(null), false);
    });

    it('without custom settings everything goes, the deepest first', () => {
        const root = 'satellite-display.0.satellites.kitchen';
        const plan = planRemoval(root, {
            [root]: obj(),
            [`${root}.connected`]: obj(),
            [`${root}.tiles`]: obj(),
            [`${root}.tiles.a`]: obj(),
        });
        assert.deepEqual(plan.keep, []);
        assert.deepEqual(plan.remove, [`${root}.tiles.a`, `${root}.connected`, `${root}.tiles`, root]);
    });

    it('a state with custom settings stays, with the folders above it', () => {
        const root = 'satellite-display.0.satellites.kitchen';
        const plan = planRemoval(root, {
            [root]: obj(),
            [`${root}.connected`]: obj(),
            [`${root}.tiles`]: obj(),
            [`${root}.tiles.a`]: obj({ 'history.0': { enabled: true } }),
            [`${root}.tiles.b`]: obj(),
        });
        assert.deepEqual(plan.keep, [`${root}.tiles.a`]);
        assert.deepEqual(plan.remove, [`${root}.tiles.b`, `${root}.connected`]);
    });

    it('a single state with custom settings stays', () => {
        const id = 'satellite-display.0.satellites.kitchen.locked';
        assert.deepEqual(planRemoval(id, { [id]: obj({ 'sql.0': { enabled: true } }) }), { remove: [], keep: [id] });
        assert.deepEqual(planRemoval(id, { [id]: obj() }), { remove: [id], keep: [] });
    });
});
