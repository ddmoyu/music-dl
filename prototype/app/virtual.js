export const PAGE_SIZE = 50;
export const ROW_HEIGHT = 64;
export const TASK_HEIGHT = 80;

// Row heights are fixed in CSS. Only the visible window and a small overscan
// enter the DOM, regardless of how many pages have already been loaded.
export function virtualWindow(
    count,
    scrollTop = 0,
    viewportHeight = 400,
    rowHeight = ROW_HEIGHT,
    overscan = 5,
) {
    const height = Math.max(1, viewportHeight);
    const first = Math.min(Math.max(0, count - 1), Math.floor(Math.max(0, scrollTop) / rowHeight));
    const start = Math.max(0, first - overscan);
    const end = Math.min(count, first + Math.ceil(height / rowHeight) + overscan + 1);
    return { start, end, before: start * rowHeight, after: Math.max(0, (count - end) * rowHeight) };
}

// Cancel obsolete requests and reject late responses after search/source changes.
export class PagedResults {
    constructor(onChange, pageSize = PAGE_SIZE) {
        this.onChange = onChange;
        this.pageSize = pageSize;
        this.resetState();
    }
    resetState() {
        this.items = [];
        this.cursor = 0;
        this.total = 0;
        this.loading = false;
        this.error = '';
        this.hasMore = false;
    }
    reset(fetchPage, total = 0) {
        this.controller?.abort();
        this.controller = new AbortController();
        this.resetState();
        this.fetchPage = fetchPage;
        this.total = total;
        this.hasMore = !!fetchPage;
        if (!this.hasMore) this.onChange();
        return this.load();
    }
    snapshot() {
        return {
            items: [...this.items],
            cursor: this.cursor,
            total: this.total,
            error: this.error,
            hasMore: this.hasMore,
            fetchPage: this.fetchPage,
        };
    }
    restore(snapshot) {
        this.controller?.abort();
        this.controller = new AbortController();
        this.resetState();
        Object.assign(this, snapshot, { items: [...snapshot.items] });
        this.onChange();
        if (!this.items.length && this.hasMore && !this.error) void this.load();
    }
    async load() {
        if (!this.hasMore || this.loading || !this.fetchPage) return;
        const controller = this.controller;
        this.loading = true;
        this.error = '';
        this.onChange();
        try {
            const page = await this.fetchPage(this.cursor, this.pageSize, controller.signal);
            if (controller !== this.controller || controller.signal.aborted) return;
            const seen = new Set(this.items.map((item) => item.id));
            for (const item of page.items) {
                if (seen.has(item.id)) continue;
                seen.add(item.id);
                this.items.push(item);
            }
            this.cursor = page.nextCursor;
            this.total = page.total;
            this.hasMore = page.nextCursor !== null;
        } catch (error) {
            if (controller !== this.controller || controller.signal.aborted) return;
            this.error = error.message || '加载失败，请重试';
        } finally {
            if (controller === this.controller && !controller.signal.aborted) {
                this.loading = false;
                this.onChange();
            }
        }
    }
}
