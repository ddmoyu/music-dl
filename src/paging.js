import { identity } from './api.js';
export function virtualWindow(count, top, height, rowHeight = 72) {
    const start = Math.max(0, Math.min(count, Math.floor(top / rowHeight) - 5));
    const end = Math.min(count, start + Math.ceil(height / rowHeight) + 11);
    return { start, end, before: start * rowHeight, after: (count - end) * rowHeight };
}
export class Pager {
    constructor(change) {
        this.change = change;
        this.reset(null);
    }
    reset(fetchPage) {
        this.controller?.abort();
        this.controller = new AbortController();
        Object.assign(this, {
            fetchPage,
            items: [],
            cursor: null,
            hasMore: !!fetchPage,
            loading: false,
            error: '',
            capped: false,
        });
    }
    snapshot() {
        return {
            fetchPage: this.fetchPage,
            items: [...this.items],
            cursor: this.cursor,
            hasMore: this.hasMore,
            error: this.error,
            capped: this.capped,
        };
    }
    restore(value) {
        this.reset(value.fetchPage);
        Object.assign(this, value);
        this.change();
    }
    async load() {
        if (this.loading || !this.hasMore) return;
        const controller = this.controller;
        this.loading = true;
        this.error = '';
        this.change();
        try {
            const page = await this.fetchPage(this.cursor, controller.signal);
            if (controller !== this.controller) return;
            const seen = new Set(this.items.map(identity));
            for (const item of page.items)
                if (!seen.has(identity(item))) {
                    seen.add(identity(item));
                    this.items.push(item);
                }
            if (!page.error && page.nextCursor != null && page.nextCursor === this.cursor)
                throw new Error('分页游标没有更新，请刷新列表');
            this.cursor = page.nextCursor;
            this.hasMore = page.nextCursor != null;
            this.error = page.error || '';
            if (this.items.length >= 5000) {
                this.items = this.items.slice(0, 5000);
                this.capped = this.hasMore;
                this.hasMore = false;
            }
        } catch (error) {
            if (controller === this.controller && !controller.signal.aborted)
                this.error = error.message;
        } finally {
            if (controller === this.controller) {
                this.loading = false;
                this.change();
            }
        }
    }
}
