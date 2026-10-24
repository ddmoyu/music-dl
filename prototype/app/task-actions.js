import { changeTask, isPending } from './queue.js';

export function canTaskAction(task, action) {
    if (!task) return false;
    if (action === 'cancel')
        return isPending(task) && !['finalizing', 'canceling'].includes(task.status);
    if (action === 'retry') return ['failed', 'canceled'].includes(task.status);
    if (action === 'delete' || action === 'redownload') return !isPending(task);
    return false;
}

// Recheck current status at execution time; menu state may be older than a tick.
export function applyTaskAction(tasks, ids, action, settings) {
    const requested = new Set(ids);
    const eligible = tasks.filter((task) => requested.has(task.id) && canTaskAction(task, action));
    let next = tasks;
    let changed = 0;
    if (action === 'delete') {
        const removable = new Set(eligible.map((task) => task.id));
        next = tasks.filter((task) => !removable.has(task.id));
        changed = removable.size;
    } else if (action === 'cancel') {
        const cancelable = new Set(eligible.map((task) => task.id));
        next = tasks.map((task) => {
            if (!cancelable.has(task.id)) return task;
            changed++;
            return {
                ...task,
                status: ['queued', 'waiting_retry'].includes(task.status)
                    ? 'canceled'
                    : 'canceling',
                speed: 0,
            };
        });
    } else {
        for (const task of eligible) {
            const before = next.length;
            next = changeTask(next, task.id, action, settings);
            changed += next.length - before;
        }
    }
    return { tasks: next, changed, skipped: requested.size - changed };
}
