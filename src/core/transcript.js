'use strict';
/**
 * TranscriptStore — session message history with compaction
 */

class TranscriptStore {
    constructor({ entries = [], flushed = false } = {}) {
        this.entries = [...entries];
        this.flushed = flushed;
    }

    append(entry) {
        this.entries.push(entry);
        this.flushed = false;
    }

    compact(keepLast = 12) {
        if (this.entries.length > keepLast) {
            this.entries = this.entries.slice(-keepLast);
        }
    }

    /** Return immutable snapshot of entries */
    replay() {
        return Object.freeze([...this.entries]);
    }

    /** Mark as persisted */
    flush() {
        this.flushed = true;
    }

    get size() { return this.entries.length; }

    toJSON() {
        return { entries: this.entries, flushed: this.flushed };
    }
}

module.exports = { TranscriptStore };
