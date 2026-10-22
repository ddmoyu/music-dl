// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { updateHTML, escapeHTML } from '../app/dom.js';

let root;
beforeEach(() => {
    document.body.innerHTML = '<div id="test-root"></div>';
    root = document.getElementById('test-root');
});

describe('native DOM updates', () => {
    it('preserves focused input, caret and scroll while progress changes', () => {
        const page = (progress) =>
            `<input value="周杰伦"><div data-key="list"><div data-key="song">${progress}%</div></div>`;
        updateHTML(root, page(0));
        const input = root.querySelector('input');
        const list = root.querySelector('[data-key="list"]');
        const song = list.firstElementChild;
        input.focus();
        input.setSelectionRange(1, 2);
        list.scrollTop = 150;
        updateHTML(root, page(35));
        expect(document.activeElement).toBe(input);
        expect([input.selectionStart, input.selectionEnd]).toEqual([1, 2]);
        expect(root.querySelector('[data-key="list"]')).toBe(list);
        expect(list.scrollTop).toBe(150);
        expect(list.firstElementChild).toBe(song);
        expect(song.textContent).toBe('35%');
    });

    it('keeps task identity when rows are inserted, reordered and removed', () => {
        const rows = (ids) => ids.map((id) => `<button data-key="${id}">${id}</button>`).join('');
        updateHTML(root, rows(['a', 'b', 'c']));
        const b = root.children[1];
        updateHTML(root, rows(['c', 'd', 'b']));
        expect([...root.children].map((node) => node.textContent)).toEqual(['c', 'd', 'b']);
        expect(root.children[2]).toBe(b);
        updateHTML(root, rows(['b']));
        expect(root.children).toHaveLength(1);
        expect(root.firstElementChild).toBe(b);
    });

    it('synchronizes user-edited checkbox and select properties', () => {
        const form = (on, value) =>
            `<input type="checkbox" ${on ? 'checked' : ''}><select><option value="best" ${value === 'best' ? 'selected' : ''}>最高</option><option value="high" ${value === 'high' ? 'selected' : ''}>高</option></select>`;
        updateHTML(root, form(false, 'best'));
        root.firstElementChild.checked = true;
        root.lastElementChild.value = 'high';
        updateHTML(root, form(false, 'best'));
        expect(root.firstElementChild.checked).toBe(false);
        expect(root.lastElementChild.value).toBe('best');
        updateHTML(root, form(true, 'high'));
        expect(root.firstElementChild.checked).toBe(true);
        expect(root.lastElementChild.value).toBe('high');
    });

    it('renders user-provided strings as text, including quotes in attributes', () => {
        const input = '<img src=x onerror="alert(1)"> & \'hello\'';
        updateHTML(root, `<span title="${escapeHTML(input)}">${escapeHTML(input)}</span>`);
        expect(root.querySelector('img')).toBeNull();
        expect(root.firstElementChild.textContent).toBe(input);
        expect(root.firstElementChild.title).toBe(input);
    });
});
