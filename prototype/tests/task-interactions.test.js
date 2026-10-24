// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { addToQueue, defaults } from '../app/queue.js';
import { catalogTracks } from '../app/catalog.js';
vi.mock('@neutralinojs/lib', () => ({ init: vi.fn(), storage: {} }));

it('selects virtual tasks, handles menus and keys, and confirms record deletion without deleting active tasks', async () => {
    vi.useFakeTimers();
    localStorage.clear();
    const track = catalogTracks.find((t) => t.source === 'kuwo' && t.access === 'unknown');
    const seed = addToQueue([], [track], defaults).tasks[0];
    const completed = Array.from({ length: 120 }, (_, i) => ({
        ...seed,
        id: 'done-' + i,
        status: 'completed',
        progress: 100,
        batchId: i < 60 ? 'first' : 'second',
        track: { ...track, title: '完成任务 ' + i },
    }));
    const pending = { ...seed, id: 'pending', status: 'queued', batchId: 'pending-batch' };
    const failed = {
        ...seed,
        id: 'failed',
        status: 'failed',
        batchId: 'failed-batch',
        options: { ...defaults, quality: 'high' },
    };
    localStorage.setItem('shiyin.tasks.v1', JSON.stringify([...completed, pending, failed]));
    document.body.innerHTML = '<div id="root"></div>';
    await import('../app/main.js');
    const root = document.getElementById('root');
    const get = (selector) => {
        const el = root.querySelector(selector);
        expect(el, selector).not.toBeNull();
        return el;
    };
    const click = (selector) => {
        const el = get(selector);
        el.focus();
        el.click();
    };
    const key = (value, options = {}) =>
        window.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: value,
                bubbles: true,
                cancelable: true,
                ...options,
            }),
        );
    const tasks = () => JSON.parse(localStorage.getItem('shiyin.tasks.v1'));
    const rightClick = (id) =>
        get('[data-task-row="' + id + '"]').dispatchEvent(
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 900,
                clientY: 700,
            }),
        );
    try {
        click('[data-action="view"][data-id="downloads"]');
        click('[data-action="toggle-admission"]');
        click('[data-action="download-tab"][data-id="已完成"]');
        expect(root.querySelectorAll('[data-task-row]').length).toBeLessThan(25);
        click('[data-task-select="done-0"]');
        get('[data-task-select="done-2"]').dispatchEvent(
            new MouseEvent('click', { bubbles: true, shiftKey: true }),
        );
        expect(get('.task-selection-summary').textContent).toContain('3');
        rightClick('done-0');
        expect(get('.task-menu-caption').textContent).toContain('3');
        key('End');
        expect(document.activeElement.dataset.id).toBe('delete');
        key('Escape');
        expect(root.querySelector('[role="menu"]')).toBeNull();
        expect(document.activeElement.dataset.action).toBe('task-menu');
        rightClick('done-4');
        expect(get('.task-menu-caption').textContent).toBe('完成任务 4');
        expect(get('.task-selection-summary').textContent).toContain('1');
        key('Escape');
        key('F10', { shiftKey: true });
        expect(get('[role="menu"]')).toBeTruthy();
        key('Escape');
        const filter = get('#batch-filter');
        filter.value = 'first';
        filter.dispatchEvent(new Event('change', { bubbles: true }));
        expect(get('.task-selection-summary').textContent).toContain('0');
        click('[data-task-select-all]');
        expect(get('.task-selection-summary').textContent).toContain('60');
        const scroll = get('.task-list');
        scroll.scrollTop = 4000;
        scroll.dispatchEvent(new Event('scroll'));
        await vi.advanceTimersByTimeAsync(30);
        expect(root.querySelectorAll('[data-task-row]').length).toBeLessThan(25);
        expect([...root.querySelectorAll('[data-task-select]')].every((el) => el.checked)).toBe(
            true,
        );
        filter.value = 'all';
        filter.dispatchEvent(new Event('change', { bubbles: true }));
        get('.task-list').focus();
        key('a', { ctrlKey: true });
        expect(get('.task-selection-summary').textContent).toContain('120');
        key('Delete');
        expect(get('[role="dialog"]').textContent).toContain('120 条');
        key('Escape');
        expect(tasks()).toHaveLength(122);
        key('Delete');
        click('[data-action="confirm-task-delete"]');
        expect(tasks().map((t) => t.id)).toEqual(['pending', 'failed']);
        expect(root.querySelector('[role="dialog"]')).toBeNull();
        expect(root.querySelector('#batch-filter').value).toBe('all');
        click('[data-action="download-tab"][data-id="进行中"]');
        rightClick('pending');
        expect(get('[data-action="task-menu-action"][data-id="delete"]').disabled).toBe(true);
        click('[data-action="task-menu-action"][data-id="cancel"]');
        expect(tasks().find((t) => t.id === 'pending').status).toBe('canceled');
        click('[data-action="download-tab"][data-id="失败"]');
        click('[data-task-select-all]');
        click('[data-action="task-bulk-action"][data-id="retry"]');
        expect(tasks().at(-1).retryOf).toBe('failed');
        expect(tasks().at(-1).options.quality).toBe('high');
        expect(tasks().find((t) => t.id === 'failed').status).toBe('failed');
    } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
    }
});
