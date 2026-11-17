'use strict';

// Pairing of a tablet: the settings show a QR code with a one-time link (/pair/<code>), the ioBroker app on the
// tablet scans it and posts its name and screen size there, and the adapter enters the tablet in its own settings
// and answers with the access key of its link. Nothing has to be typed: the row of the tablet comes with the size the
// tablet really has, in the CSS pixels the tile editor works in.

const crypto = require('node:crypto');
const { idOf, TABLET_DEFAULT } = require('./layout');

/** How long a pairing code is valid */
const PAIR_MS = 10 * 60_000;
/** Codes open at the same time (every "Pair a tablet" makes one); the oldest goes first */
const MAX_CODES = 5;
/** Longest name a tablet may give itself */
const NAME_MAX = 40;
/** Screen size the settings table takes (admin/jsonConfig.json, width and height of a tablet) */
const SIZE_MIN = 100;
const SIZE_MAX = 10000;

/** One-time codes for pairing, each valid for {@link PAIR_MS}. */
class PairingCodes {
    /**
     * @param {() => number} [now] - Clock (tests)
     */
    constructor(now = () => Date.now()) {
        this.now = now;
        /** @type {Map<string, number>} code → expiry */
        this.codes = new Map();
    }

    /** @returns {{code: string, expires: number}} A new code and when it expires (ms since 1970) */
    open() {
        this.prune();
        while (this.codes.size >= MAX_CODES) {
            this.codes.delete(/** @type {string} */ (this.codes.keys().next().value));
        }
        const code = crypto.randomBytes(18).toString('base64url');
        const expires = this.now() + PAIR_MS;
        this.codes.set(code, expires);
        return { code, expires };
    }

    /**
     * Takes a code: true once for every valid code, false for an unknown, expired or already used one.
     *
     * @param {unknown} code - Code from the request of the tablet
     * @returns {boolean} The code was valid; it is used up now
     */
    take(code) {
        this.prune();
        const given = crypto
            .createHash('sha256')
            .update(String(code ?? ''))
            .digest();
        let found = '';
        // compared in constant time, all of them, as the access keys (main.js, tabletOfKey)
        for (const c of this.codes.keys()) {
            if (crypto.timingSafeEqual(given, crypto.createHash('sha256').update(c).digest())) {
                found = c;
            }
        }
        if (!found) {
            return false;
        }
        this.codes.delete(found);
        return true;
    }

    /** Forgets the expired codes. */
    prune() {
        const now = this.now();
        for (const [code, expires] of this.codes) {
            if (expires <= now) {
                this.codes.delete(code);
            }
        }
    }
}

/**
 * The name a tablet gave itself, fit for the settings: one line, no control characters, at most {@link NAME_MAX}.
 *
 * @param {unknown} name - Name from the request
 * @returns {string} The name, "Tablet" when nothing is left of it
 */
function cleanName(name) {
    const text = String(name ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return Array.from(text).slice(0, NAME_MAX).join('').trim() || 'Tablet';
}

/**
 * @param {unknown} value - Width or height from the request
 * @returns {number | undefined} Whole CSS pixels within the limits of the table, undefined when it is no number
 */
function sizeOf(value) {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
    return Number.isFinite(n) ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n))) : undefined;
}

/**
 * The row of the settings table for a tablet that paired itself. A name already taken by a satellite or a tablet
 * (enabled or not) gets a number; an upright screen gets the grid turned (3 x 4 instead of 4 x 3).
 *
 * @param {{name?: unknown, width?: unknown, height?: unknown}} request - What the tablet sent
 * @param {Iterable<string>} names - Names of the satellites and tablets in the settings
 * @returns {Record<string, unknown>} The row for native.tablets
 */
function pairedRow(request, names) {
    const taken = new Set([...names].map(idOf));
    const base = cleanName(request.name);
    let name = base;
    for (let n = 2; taken.has(idOf(name)); n++) {
        name = `${base} ${n}`;
    }
    const width = sizeOf(request.width);
    const height = sizeOf(request.height);
    const upright = width !== undefined && height !== undefined && height > width;
    return {
        enabled: true,
        name,
        ...(width !== undefined && height !== undefined ? { width, height } : {}),
        cols: upright ? TABLET_DEFAULT.rows : TABLET_DEFAULT.cols,
        rows: upright ? TABLET_DEFAULT.cols : TABLET_DEFAULT.rows,
        pages: TABLET_DEFAULT.pages,
        lockEnabled: false,
        pin: '',
    };
}

/**
 * The names of the satellites and tablets of the settings, every row, enabled or not.
 *
 * @param {{satellites?: unknown, tablets?: unknown}} native - Settings of the instance
 * @returns {string[]} Their names
 */
function namesOf(native) {
    /** @type {string[]} */
    const names = [];
    for (const rows of [native.satellites, native.tablets]) {
        const list = Array.isArray(rows) ? rows : rows && typeof rows === 'object' ? Object.values(rows) : [];
        for (const row of list) {
            const name = String(row?.name ?? '').trim();
            if (name) {
                names.push(name);
            }
        }
    }
    return names;
}

module.exports = { PairingCodes, pairedRow, cleanName, namesOf, PAIR_MS, MAX_CODES, NAME_MAX };
