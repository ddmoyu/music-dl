import { applyTaskProjection } from './tasks.js';
import { terminal } from './api.js';
import { collectTasks } from './task-list.js';

export class TaskSync {
    constructor(api, tasks, change) {
        this.api = api;
        this.tasks = tasks;
        this.change = change;
        this.refresh = new Set();
        this.pollOffset = 0;
    }
    receive(event) {
        if (!event || event.poll) {
            const active = [...this.tasks.active.values()];
            const wanted = event?.poll
                ? active.slice(this.pollOffset, this.pollOffset + 50)
                : active;
            for (const task of wanted) this.refresh.add(task.task_id);
            this.pollOffset = active.length ? (this.pollOffset + 50) % active.length : 0;
            return;
        }
        const previous = this.tasks.get(event.task_id);
        const updated = applyTaskProjection(previous, event);
        if (updated !== previous) {
            this.tasks.merge([updated]);
            // SSE omits source_retry/actual_track. Refresh stage transitions as
            // well as terminal events, including older tasks outside page one.
            if (terminal(updated) || updated.status !== previous.status)
                this.refresh.add(updated.task_id);
        }
    }
    async synchronize(visible = true) {
        const tasks = this.tasks;
        if (!tasks.complete || tasks.loading || !visible) {
            await this.api.request('/info');
            return;
        }
        const generation = tasks.controller;
        const updates = await collectTasks(tasks.fetchPage, generation.signal, tasks.byId);
        if (generation !== tasks.controller) return;
        tasks.merge(updates);
        for (const task of updates)
            if (task.version >= tasks.get(task.task_id).version) this.refresh.delete(task.task_id);
        const wanted = [...this.refresh].filter((id) => tasks.byId.has(id)).slice(0, 50);
        for (let i = 0; i < wanted.length; i += 4)
            await Promise.all(
                wanted.slice(i, i + 4).map(async (id) => {
                    const { data } = await this.api.request(
                        `/downloads/${encodeURIComponent(id)}`,
                        { signal: generation.signal },
                    );
                    if (generation !== tasks.controller) return;
                    tasks.merge([data]);
                    if (data.version >= tasks.get(id).version) this.refresh.delete(id);
                }),
            );
        if (generation !== tasks.controller) return;
        for (const id of this.refresh) if (!tasks.byId.has(id)) this.refresh.delete(id);
        this.change();
        return this.refresh.size > 0;
    }
}
