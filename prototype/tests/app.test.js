// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
vi.mock('@neutralinojs/lib', () => ({ init: vi.fn(), storage: {} }));

it('loads virtual pages, preserves offscreen selection, navigates artist scopes, imports links and manages batches', async () => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    await import('../app/main.js');
    const root = document.getElementById('root');
    const click = (selector) => {
        const el = root.querySelector(selector);
        expect(el, selector).not.toBeNull();
        el.click();
    };
    const change = (selector, value) => {
        const el = root.querySelector(selector);
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const input = (selector, value) => {
        const el = root.querySelector(selector);
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const submit = (form) =>
        root
            .querySelector(`[data-form="${form}"]`)
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const settle = () => vi.advanceTimersByTimeAsync(200);
    const search = async (value) => {
        input('#search-input', value);
        submit('search');
        await settle();
    };
    const tasks = () => JSON.parse(localStorage.getItem('shiyin.tasks.v1'));
    try {
        change('#source', 'kuwo');
        await search('林间集');
        expect(root.querySelector('[role="table"]').getAttribute('aria-rowcount')).toBe('1201');
        expect(root.querySelectorAll('.track-row').length).toBeLessThan(25);
        const firstId = root.querySelector('[data-select]').dataset.select;
        click('[data-select]');
        const scroll = root.querySelector('.virtual-scroll');
        scroll.scrollTop = 2900;
        scroll.dispatchEvent(new Event('scroll'));
        await settle();
        expect(root.querySelector('.load-status').textContent).toContain('100 / 1200');
        expect(root.querySelectorAll('.track-row').length).toBeLessThan(25);
        expect(root.querySelector(`[data-select="${firstId}"]`)).toBeNull();
        expect(root.querySelector('.selection-count').textContent).toContain('1');
        scroll.scrollTop = 0;
        scroll.dispatchEvent(new Event('scroll'));
        await settle();
        expect(root.querySelector(`[data-select="${firstId}"]`).checked).toBe(true);
        input('#search-input', '新的草稿');
        const field = root.querySelector('#search-input');
        field.focus();
        field.setSelectionRange(1, 2);
        click('[data-action="download-selected"]');
        click('[data-action="confirm-bulk"]');
        await settle();
        expect(tasks()).toHaveLength(1);
        click('[data-action="close-modal"]');
        expect(root.querySelector('#search-input')).toBe(field);
        expect(field.value).toBe('新的草稿');
        expect(field.selectionStart).toBe(1);
        click('[data-action="search-type"][data-id="artists"]');
        await search('周杰伦');
        expect(root.querySelectorAll('.artist-row').length).toBe(1);
        click('[data-action="artist"]');
        await settle();
        expect(root.querySelector('.artist-context').textContent).toContain('完整作品目录');
        click('[data-action="artist-tab"][data-id="albums"]');
        await settle();
        click('[data-action="collection"]');
        await settle();
        expect(root.querySelector('.collection-breadcrumb').textContent).toContain('十一月的萧邦');
        click('[data-action="back"]');
        await settle();
        expect(root.querySelectorAll('.collection-row').length).toBeGreaterThan(0);
        click('[data-action="back"]');
        await settle();
        change('#source', 'migu');
        await settle();
        click('[data-action="artist"]');
        await settle();
        expect(
            root
                .querySelector('[data-action="search-type"][data-id="tracks"]')
                .getAttribute('aria-pressed'),
        ).toBe('true');
        expect(root.querySelector('.artist-context')).toBeNull();
        expect(root.querySelector('[data-action="open-link"]')).toBeNull();
        input('#search-input', 'https://www.kuwo.cn/playlist_detail/forest');
        submit('search');
        expect(root.querySelector('.link-result').textContent).toContain('1200');
        click('[data-action="open-link-result"]');
        await settle();
        click('[data-action="download-all"]');
        click('[data-action="confirm-bulk"]');
        await vi.advanceTimersByTimeAsync(1000);
        expect(root.querySelector('.bulk-progress').textContent).toContain('1200 / 1200');
        expect(root.querySelector('.bulk-progress').textContent).toMatch(/队列已满 [1-9]/);
        click('[data-action="bulk-tasks"]');
        expect(root.querySelectorAll('[data-task-row]').length).toBeLessThan(25);
        click('[data-action="toggle-admission"]');
        expect(root.querySelector('.task-filter').textContent).toContain('正在执行的任务会继续');
        const batch = root.querySelector('#batch-filter option:nth-child(2)').value;
        change('#batch-filter', batch);
        click('[data-action="cancel-batch"]');
        await vi.advanceTimersByTimeAsync(700);
        click('[data-action="download-tab"][data-id="已取消"]');
        expect(root.querySelectorAll('[data-task-row]').length).toBeGreaterThan(0);
        click('[data-action="task-detail"]');
        expect(root.querySelector('[role="dialog"]').textContent).toContain('下载目标');
        click('[data-action="close-modal"]');
        click('[data-action="settings"]');
        change('[data-setting="quality"]', 'hires');
        change('[data-setting="destination"]', 'archive');
        expect(JSON.parse(localStorage.getItem('shiyin.settings.v1')).destination).toBe('archive');
        expect(root.querySelector('[data-action="concurrency"]')).toBeNull();
        input('#service-url', 'http://127.0.0.1:17632');
        input('#service-token', 'test_only_token');
        submit('service');
        const persisted = Array.from({ length: localStorage.length }, (_, i) =>
            localStorage.getItem(localStorage.key(i)),
        ).join('');
        expect(persisted).not.toContain('test_only_token');
    } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
    }
});
