import { terminal } from './api.js';

// Download history is loaded independently of scrolling. The API remains paginated
// so only one bounded response is in flight, while the UI publishes a complete list.
export async function collectTasks(fetchPage, signal, knownIds = new Set()) {
    const items = new Map();
    const cursors = new Set();
    let cursor = null;
    do {
        signal.throwIfAborted();
        const page = await fetchPage(cursor, signal);
        signal.throwIfAborted();
        if (page.error) throw new Error(page.error);
        for (const task of page.items) {
            const previous = items.get(task.task_id);
            if (!previous || task.version >= previous.version) items.set(task.task_id, task);
        }
        // Tasks are ordered by creation time. During synchronization, stop once
        // the new prefix reaches our already fully loaded history.
        if (page.items.some((task) => knownIds.has(task.task_id))) break;
        cursor = page.nextCursor;
        if (cursor != null && cursors.has(cursor)) throw new Error('任务分页游标重复，请刷新列表');
        cursors.add(cursor);
    } while (cursor != null);
    return [...items.values()];
}

export class TaskList {
    constructor(change) {
        this.change = change;
        this.reset(null);
    }
    reset(fetchPage) {
        this.controller?.abort();
        this.controller = new AbortController();
        this.fetchPage = fetchPage;
        this.items = [];
        this.byId = new Map();
        this.positions = new Map();
        this.active = new Map();
        this.revision = (this.revision || 0) + 1;
        this.loading = false;
        this.complete = false;
        this.error = '';
    }
    get(id) {
        return this.byId.get(id);
    }
    merge(updates) {
        let reorder = false;
        for (const task of updates) {
            const previous = this.get(task.task_id);
            if (previous && previous.version > task.version) continue;
            if (previous) {
                this.items[this.positions.get(task.task_id)] = task;
                if (previous.created_at !== task.created_at) reorder = true;
            } else {
                this.positions.set(task.task_id, this.items.length);
                this.items.push(task);
                reorder = true;
            }
            this.byId.set(task.task_id, task);
            if (terminal(task)) this.active.delete(task.task_id);
            else this.active.set(task.task_id, task);
            this.revision++;
        }
        if (reorder) {
            this.items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
            this.positions = new Map(this.items.map((task, index) => [task.task_id, index]));
        }
    }
    visible(hidden, filter) {
        if (
            this.visibleCache?.revision !== this.revision ||
            this.visibleCache.hidden !== hidden ||
            this.visibleCache.filter !== filter
        )
            this.visibleCache = {
                revision: this.revision,
                hidden,
                filter,
                items: this.items.filter(
                    (task) => !hidden.has(task.task_id) && (!filter || task.status === filter),
                ),
            };
        return this.visibleCache.items;
    }
    async load() {
        if (this.loading || !this.fetchPage) return;
        const controller = this.controller;
        this.loading = true;
        this.error = '';
        this.change();
        try {
            const items = await collectTasks(this.fetchPage, controller.signal);
            if (controller !== this.controller) return;
            this.merge(items);
            this.complete = true;
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
