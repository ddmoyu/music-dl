// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
vi.mock('@neutralinojs/lib', () => ({ init: vi.fn(), storage: {} }));

it('restores nested lists, independent view positions, and fills a resized viewport without extra scrolling', async () => {
    vi.useFakeTimers();
    localStorage.clear();
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
    const settle = (time = 220) => vi.advanceTimersByTimeAsync(time);
    const source = async (value) => {
        const el = get('#source');
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        await settle();
        expect(document.activeElement).toBe(get('#source'));
    };
    const scrollTo = async (top) => {
        const el = get('.virtual-scroll');
        el.scrollTop = top;
        el.dispatchEvent(new Event('scroll'));
        await settle();
    };
    const mode = (id) => click(`[data-action="catalog-mode"][data-id="${id}"]`);
    try {
        await source('kuwo');
        mode('recommendations');
        await settle();
        await scrollTo(2900);
        const listTop = get('.virtual-scroll').scrollTop;
        const selected = get('[data-select]').dataset.select;
        click('[data-select]');
        const collection = get('[data-action="collection"]').dataset.id;
        click('[data-action="collection"]');
        await settle();
        await scrollTo(2900);
        const trackTop = get('.virtual-scroll').scrollTop;
        const track = get('[data-select]:not(:disabled)').dataset.select;
        click('[data-select]:not(:disabled)');
        click('[data-action="open-track-artist"]');
        await settle();
        click('[data-action="artist-tab"][data-id="albums"]');
        await settle();
        click('[data-action="collection"]');
        await settle();
        expect(root.querySelector('.artist-context')).toBeNull();
        click('[data-action="back"]');
        expect(get('.artist-context .active').textContent).toBe('专辑');
        click('[data-action="back"]');
        expect(get('.virtual-scroll').scrollTop).toBe(trackTop);
        expect(get(`[data-select="${track}"]`).checked).toBe(true);
        expect(get('.load-status').textContent).toContain('全部 80');
        click('[data-action="back"]');
        expect(get('.virtual-scroll').scrollTop).toBe(listTop);
        expect(get('.load-status').textContent).toContain('100 / 126');
        expect(get(`[data-select="${selected}"]`).checked).toBe(true);
        expect(document.activeElement.dataset.id).toBe(collection);
        expect(root.querySelector('.collection-breadcrumb')).toBeNull();

        // Visiting settings/downloads and reselecting the active mode must preserve the list.
        mode('recommendations');
        expect(get('.virtual-scroll').scrollTop).toBe(listTop);
        click('[data-action="settings"]');
        click('[data-action="settings"]');
        expect(get('.virtual-scroll').scrollTop).toBe(listTop);
        click('[data-action="view"][data-id="downloads"]');
        click('[data-action="settings"]');
        click('[data-action="settings"]');
        expect(get('.main-panel').classList.contains('downloads')).toBe(true);
        mode('recommendations');
        expect(get('.virtual-scroll').scrollTop).toBe(listTop);
        expect(get(`[data-select="${selected}"]`).checked).toBe(true);

        // Back during an in-flight detail request immediately restores the parent.
        click('[data-action="collection"]');
        click('[data-action="back"]');
        await settle();
        expect(get('.load-status').textContent).toContain('100 / 126');
        expect(get('.virtual-scroll').scrollTop).toBe(listTop);
        expect(root.querySelectorAll('.collection-row').length).toBeLessThan(25);

        click('[data-action="collection"]');
        await source('bilibili');
        expect(root.querySelector('[data-action="back"]')).toBeNull();
        expect(
            root.querySelector('[data-action="catalog-mode"][data-id="recommendations"]'),
        ).not.toBeNull();
        expect(get('[data-action="search-type"][data-id="artists"]').disabled).toBe(true);
        await source('kuwo');
        click('[data-action="search-type"][data-id="artists"]');
        await source('qianqian');
        expect(get('[data-action="search-type"][aria-pressed="true"]').dataset.id).toBe('tracks');

        mode('recommendations');
        await settle();
        expect(get('.load-status').textContent).toContain('50 / 126');
        Object.defineProperty(get('.virtual-scroll'), 'clientHeight', {
            configurable: true,
            value: 8000,
        });
        window.dispatchEvent(new Event('resize'));
        await settle(600);
        expect(get('.load-status').textContent).toContain('全部 126');
        expect(get('.virtual-scroll').scrollTop).toBe(0);

        // A provider without an artist catalog falls back to search, but Back still works.
        await source('migu');
        mode('search');
        click('[data-action="search-type"][data-id="artists"]');
        const input = get('#search-input');
        input.value = '周杰伦';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        get('[data-form="search"]').dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
        );
        await settle();
        click('[data-action="artist"]');
        await settle();
        expect(get('[data-action="search-type"][aria-pressed="true"]').dataset.id).toBe('tracks');
        click('[data-action="back"]');
        expect(get('[data-action="search-type"][aria-pressed="true"]').dataset.id).toBe('artists');
        expect(get('.artist-row').textContent).toContain('周杰伦');
    } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
    }
});
