'use strict';

// Objects the adapter removes (a renamed or removed satellite, the tablets when the PWA is off, the states of the
// screen lock) may carry settings of the user in common.custom: History, InfluxDB, SQL and others. Deleting such an
// object loses those settings, and a history adapter may still hold data of it (review of PR 7136, 2026-11-16).
// Therefore such an object is kept, with a warning; the rest of the device goes as before.

/**
 * True when the object carries a setting of another adapter in common.custom (a removed setting may stay as null).
 *
 * @param {ioBroker.Object | null | undefined} obj - Object to check
 * @returns {boolean} Whether it has custom settings
 */
function hasCustom(obj) {
    const custom = obj?.common?.custom;
    return !!custom && typeof custom === 'object' && Object.values(custom).some(v => v !== null && v !== undefined);
}

/**
 * Sorts the objects of a tree into those that may go and those that stay. An object stays when it carries custom
 * settings or when an object below it does (a folder or device is not removed from under a kept state).
 *
 * @param {string} rootId - Full id of the top object
 * @param {Record<string, ioBroker.Object>} objects - The top object and everything below it, by full id
 * @returns {{ remove: string[], keep: string[] }} Full ids, the deepest first in remove
 */
function planRemoval(rootId, objects) {
    const custom = Object.keys(objects).filter(id => hasCustom(objects[id]));
    const keep = new Set(custom);
    for (const id of custom) {
        // every parent up to the top stays as well
        let parent = id;
        while (parent !== rootId && parent.includes('.')) {
            parent = parent.slice(0, parent.lastIndexOf('.'));
            if (parent === rootId || parent.startsWith(`${rootId}.`)) {
                keep.add(parent);
            }
        }
    }
    const remove = Object.keys(objects)
        .filter(id => !keep.has(id))
        .sort((a, b) => b.split('.').length - a.split('.').length || a.localeCompare(b));
    return { remove, keep: custom.sort() };
}

module.exports = { hasCustom, planRemoval };
