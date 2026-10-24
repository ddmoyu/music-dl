import { expect, it } from 'vitest';
import { applyTaskAction, canTaskAction } from '../app/task-actions.js';
import { addToQueue, defaults, MAX_TASKS } from '../app/queue.js';
import { catalogTracks } from '../app/catalog.js';
const track = catalogTracks.find((t) => t.source === 'kuwo' && t.access === 'unknown');
const task = (id, status) => ({ ...addToQueue([], [track], defaults).tasks[0], id, status });

it('only cancels eligible work and never deletes an active or finalizing task', () => {
    const statuses = [
        'queued',
        'waiting_retry',
        'downloading',
        'finalizing',
        'canceling',
        'completed',
        'failed',
        'canceled',
    ];
    const tasks = statuses.map((status) => task(status, status));
    const ids = [...statuses, 'missing'];
    const canceled = applyTaskAction(tasks, ids, 'cancel', defaults);
    expect(canceled.changed).toBe(3);
    expect(canceled.skipped).toBe(6);
    expect(canceled.tasks.slice(0, 5).map((t) => t.status)).toEqual([
        'canceled',
        'canceled',
        'canceling',
        'finalizing',
        'canceling',
    ]);
    const deleted = applyTaskAction(tasks, ids, 'delete', defaults);
    expect(deleted.changed).toBe(3);
    expect(deleted.tasks.map((t) => t.status)).toEqual(statuses.slice(0, 5));
    expect(tasks).toHaveLength(8);
    expect(canTaskAction(tasks[3], 'cancel')).toBe(false);
    expect(canTaskAction(tasks[0], 'pause')).toBe(false);
});

it('rechecks status at execution, deduplicates retry intents, and reports capacity skips', () => {
    const first = task('first', 'failed');
    first.options = { ...defaults, quality: 'high', allowLower: false };
    const second = { ...first, id: 'second', status: 'canceled' };
    const result = applyTaskAction([first, second], ['first', 'second'], 'retry', {
        ...defaults,
        quality: 'standard',
    });
    expect(result.changed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.tasks.at(-1).retryOf).toBe('first');
    expect(result.tasks.at(-1).options.quality).toBe('high');
    expect(result.tasks.at(-1).options.allowLower).toBe(false);
    first.status = 'finalizing';
    expect(applyTaskAction([first], ['first'], 'delete', defaults).changed).toBe(0);
    const full = Array.from({ length: MAX_TASKS }, (_, i) => ({ ...second, id: String(i) }));
    expect(applyTaskAction(full, ['0', '1'], 'retry', defaults)).toMatchObject({
        changed: 0,
        skipped: 2,
    });
});
