// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
vi.mock('@neutralinojs/lib', () => ({ init: vi.fn(), os: {}, storage: {} }));

it('preserves search, batch download, queue controls, settings and dialog interactions', async () => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    await import('../app/main.js');
    const root = document.getElementById('root');
    const click = (selector) => {
        const element = root.querySelector(selector);
        expect(element, selector).not.toBeNull();
        element.click();
    };
    const change = (selector, value) => {
        const element = root.querySelector(selector);
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const search = (value) => {
        const input = root.querySelector('#search-input');
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        root.querySelector('[data-form="search"]').dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
    };
    const tasks = () => JSON.parse(localStorage.getItem('shiyin.tasks.v1'));
    try {
        search('周杰伦');
        expect(root.querySelectorAll('tbody tr').length).toBeGreaterThan(5);
        click('[data-select-all]');
        expect(root.querySelectorAll('tbody input:checked').length).toBeGreaterThan(5);
        click('[data-action="download-selected"]');
        vi.advanceTimersByTime(600);
        expect(tasks().filter((t) => t.status === 'downloading')).toHaveLength(3);
        const input = root.querySelector('#search-input');
        input.focus();
        input.setSelectionRange(1, 2);
        click('tbody input');
        vi.advanceTimersByTime(600);
        expect(root.querySelector('#search-input')).toBe(input);
        expect(input.selectionStart).toBe(1);
        expect(root.querySelectorAll('tbody input:checked')).toHaveLength(1);
        click('[data-action="toggle-all"]');
        const paused = tasks().map((t) => t.progress);
        vi.advanceTimersByTime(1200);
        expect(tasks().map((t) => t.progress)).toEqual(paused);
        expect(tasks().every((t) => t.status === 'paused')).toBe(true);
        click('[data-action="collapse-queue"]');
        expect(root.querySelector('.queue-drawer').inert).toBe(true);
        expect(root.querySelector('.queue-drawer').getAttribute('aria-hidden')).toBe('true');
        click('[data-action="status"]');
        expect(root.querySelector('.queue-drawer').inert).toBe(false);
        click('[data-action="settings"]');
        change('[data-setting="quality"]', 'lossless');
        click('[data-action="concurrency"][data-id="-1"]');
        expect(JSON.parse(localStorage.getItem('shiyin.settings.v1')).concurrency).toBe(2);
        click('[data-action="choose-directory"]');
        expect(document.activeElement.id).toBe('directory-input');
        expect(root.querySelector('main').inert).toBe(true);
        const directory = root.querySelector('#directory-input');
        directory.value = 'D:/音乐';
        directory.dispatchEvent(new Event('input', { bubbles: true }));
        root.querySelector('[data-form="directory"]').dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        expect(JSON.parse(localStorage.getItem('shiyin.settings.v1')).directory).toBe('D:/音乐');
        expect(root.querySelector('[role="dialog"]')).toBeNull();
        expect(root.querySelector('main').inert).toBe(false);
        click('[data-action="view"][data-id="downloads"]');
        click('[data-action="toggle-all"]');
        vi.advanceTimersByTime(600);
        expect(tasks().filter((t) => t.status === 'downloading')).toHaveLength(2);
        click('[data-action="toggle-all"]');
        click('[data-action="view"][data-id="search"]');
        click('[data-action="search-type"][data-id="albums"]');
        expect(root.querySelectorAll('.collection-name').length).toBeGreaterThan(0);
        click('.collection-name');
        expect(root.querySelector('.collection-breadcrumb')).not.toBeNull();
        click('[data-action="back"]');
        click('[data-action="search-type"][data-id="playlists"]');
        search('风');
        expect(root.querySelectorAll('.collection-name').length).toBeGreaterThan(0);
        click('[data-select-all]');
        click('[data-action="download-selected"]');
        expect(new Set(tasks().map((t) => t.track.id)).size).toBe(tasks().length);
        click('[data-action="search-type"][data-id="tracks"]');
        search('起风了');
        click('[data-action="preview"]');
        expect(root.querySelector('[role="status"]').textContent).toContain('没有可用的试听音源');
        change('#source', '5sing');
        expect(root.querySelector('.empty-results h2').textContent).toBe('没有找到相关结果');
    } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
    }
});
