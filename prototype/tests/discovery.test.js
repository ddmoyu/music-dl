// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { prepareCatalog } from '../app/catalog.js';
vi.mock('@neutralinojs/lib', () => ({ init: vi.fn(), storage: {} }));

it('switches discovery capabilities, pages virtual rows and opens ranked tracks and public playlists', async () => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    await import('../app/main.js');
    const root = document.getElementById('root');
    const mode = (id) => root.querySelector(`[data-action="catalog-mode"][data-id="${id}"]`);
    const click = (selector) => {
        const el = root.querySelector(selector);
        expect(el, selector).not.toBeNull();
        el.click();
    };
    const source = (value) => {
        const select = root.querySelector('#source');
        select.focus();
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(document.activeElement).toBe(root.querySelector('#source'));
    };
    const settle = () => vi.advanceTimersByTimeAsync(200);
    const scrollTo = async (top) => {
        const scroll = root.querySelector('.virtual-scroll');
        scroll.scrollTop = top;
        scroll.dispatchEvent(new Event('scroll'));
        await settle();
    };
    try {
        expect(mode('charts')).not.toBeNull();
        expect(mode('recommendations').textContent).toBe('推荐歌单');
        mode('charts').click();
        await settle();
        expect(root.querySelector('#source').value).toBe('kuwo');
        expect(root.querySelector('[role="table"]').getAttribute('aria-label')).toBe('排行榜结果');
        expect(root.querySelector('.load-status').textContent).toContain('50 / 64');
        expect(root.querySelectorAll('.collection-row').length).toBeLessThan(25);
        const selectedId = root.querySelector('[data-select]').dataset.select;
        click('[data-select]');
        await scrollTo(2900);
        expect(root.querySelector('.load-status').textContent).toContain('全部 64');
        expect(root.querySelector(`[data-select="${selectedId}"]`)).toBeNull();
        await scrollTo(0);
        expect(root.querySelector(`[data-select="${selectedId}"]`).checked).toBe(true);
        click('[data-action="collection"]');
        await settle();
        expect(root.querySelector('.chart-rank').textContent).toBe('1');
        await scrollTo(2900);
        expect(root.querySelector('.load-status').textContent).toContain('全部 100');
        await scrollTo(3200);
        expect(
            [...root.querySelectorAll('.chart-rank')].some((el) => el.textContent === '51'),
        ).toBe(true);
        expect(root.querySelectorAll('.track-row').length).toBeLessThan(25);
        click('[data-action="download-all"]');
        expect(root.querySelector('[role="dialog"]').textContent).toContain('100 首');
        click('[data-action="close-modal"]');
        click('[data-action="back"]');
        await settle();
        expect(mode('charts').getAttribute('aria-pressed')).toBe('true');
        expect(root.querySelector('.load-status').textContent).toContain('全部 64');

        // Changing source while the next page is pending must discard old results/selection.
        mode('search').click();
        mode('charts').click();
        await settle();
        click('[data-select]');
        click('[data-action="load-more"]');
        source('qq');
        await settle();
        expect(root.querySelector('.selection-count').textContent).toContain('0');
        expect(
            [...root.querySelectorAll('[data-select]')].every((el) =>
                el.dataset.select.startsWith('qq:'),
            ),
        ).toBe(true);
        expect(root.querySelector('.source-notices')).toBeNull();
        source('qianqian');
        await settle();
        expect(mode('charts')).not.toBeNull();
        expect(mode('search').getAttribute('aria-pressed')).toBe('true');
        mode('recommendations').click();
        await settle();
        expect(root.querySelector('.load-status').textContent).toContain('50 / 126');
        await scrollTo(2900);
        expect(root.querySelector('.load-status').textContent).toContain('100 / 126');
        expect(root.querySelectorAll('.collection-row').length).toBeLessThan(25);
        click('[data-action="collection"]');
        await settle();
        expect(root.querySelectorAll('.track-row').length).toBeGreaterThan(0);
        expect(root.querySelector('.chart-rank')).toBeNull();
        click('[data-action="download-all"]');
        click('[data-action="confirm-bulk"]');
        await settle();
        const tasks = JSON.parse(localStorage.getItem('shiyin.tasks.v1'));
        expect(tasks.length).toBeGreaterThan(0);
        expect(tasks.every((task) => task.track.source === 'qianqian')).toBe(true);
        click('[data-action="close-modal"]');
        source('jamendo');
        await settle();
        expect(mode('recommendations').getAttribute('aria-pressed')).toBe('true');
        expect(root.querySelector('.collection-breadcrumb')).toBeNull();
        expect(
            [...root.querySelectorAll('[data-select]')].every((el) =>
                el.dataset.select.startsWith('jamendo:'),
            ),
        ).toBe(true);
        for (const id of ['bilibili', 'fivesing', 'all']) {
            source(id);
            await settle();
            expect(mode('charts')).not.toBeNull();
            expect(mode('recommendations')).not.toBeNull();
            expect(root.querySelector('.collection-breadcrumb')).toBeNull();
            expect(mode('search').getAttribute('aria-pressed')).toBe('true');
            mode('recommendations').click();
            await settle();
            expect(root.querySelector('#source').value).toBe('kuwo');
            expect(mode('recommendations').getAttribute('aria-pressed')).toBe('true');
        }
        source('kuwo');
        await settle();
        mode('recommendations').click();
        await settle();
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
        );
        await settle();
        expect(mode('search').getAttribute('aria-pressed')).toBe('true');
        expect(document.activeElement.id).toBe('search-input');
        click('[data-action="view"][data-id="downloads"]');
        mode('charts').click();
        await settle();
        expect(root.querySelector('.main-panel').classList.contains('search')).toBe(true);
        expect(root.querySelector('.main-nav .active').textContent).toBe('排行榜');
        click('[data-action="settings"]');
        mode('recommendations').click();
        await settle();
        expect(root.querySelector('.main-nav .active').textContent).toBe('推荐歌单');
        expect(root.querySelector('.load-status').textContent).toContain('50 / 126');
    } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
    }
});

it('gates discovery independently of keyword search and credentials', () => {
    for (const source of ['kuwo', 'netease', 'qq', 'kugou', 'migu', 'jamendo']) {
        for (const mode of ['charts', 'recommendations']) {
            const catalog = prepareCatalog({ source, mode, query: '不会命中搜索的关键词' });
            expect(catalog.items.length).toBeGreaterThan(50);
            expect(
                catalog.items.every((item) => item.source === source && item.tracks.length > 0),
            ).toBe(true);
            expect(catalog.notices).toEqual([]);
        }
    }
    expect(prepareCatalog({ source: 'qianqian', mode: 'charts' }).items).toEqual([]);
    expect(
        prepareCatalog({ source: 'qianqian', mode: 'recommendations' }).items.length,
    ).toBeGreaterThan(0);
    for (const source of ['all', 'bilibili', 'fivesing'])
        for (const mode of ['charts', 'recommendations'])
            expect(prepareCatalog({ source, mode }).items).toEqual([]);
});
