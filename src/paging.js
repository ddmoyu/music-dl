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
            resume: this.loading,
        };
    }
    restore(value) {
        this.reset(value.fetchPage);
        const { resume, ...saved } = value;
        Object.assign(this, saved);
        this.change();
        if (resume) void this.load();
    }
    async load() {
        if (this.loading || !this.hasMore) return;
        const controller = this.controller;
        const cursor = this.cursor;
        const seen = new Set(this.items.map(identity));
        let omitted = false;
        this.loading = true;
        this.error = '';
        this.change();
        const accept = (page) => {
            if (controller !== this.controller || controller.signal.aborted) return;
            for (const item of page.items)
                if (!seen.has(identity(item))) {
                    if (this.items.length >= 5000) omitted = true;
                    else {
                        seen.add(identity(item));
                        this.items.push(item);
                    }
                }
            this.cursor = page.nextCursor;
            this.hasMore = page.nextCursor != null;
            this.error = page.error || '';
            if (this.items.length >= 5000) {
                this.capped = omitted || this.hasMore;
                this.hasMore = false;
            }
        };
        try {
            const page = await this.fetchPage(cursor, controller.signal, (partial) => {
                if (controller !== this.controller || controller.signal.aborted) return;
                accept(partial);
                this.change();
            });
            if (controller !== this.controller) return;
            if (!page.error && page.nextCursor != null && page.nextCursor === cursor)
                throw new Error('分页游标没有更新，请刷新列表');
            accept(page);
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
