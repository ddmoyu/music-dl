export const escapeHTML = (value) =>
    String(value ?? '').replace(
        /[&<>"']/g,
        (char) =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[char],
    );

// Patch real DOM nodes in place. Keyed rows keep their identity, focus and scroll
// while progress changes; form properties are synchronized separately from attributes.
export function updateHTML(container, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    patchChildren(container, template.content);
}

function key(node) {
    return node.nodeType === 1 ? node.getAttribute('data-key') : null;
}

function patchChildren(parent, next) {
    let current = parent.firstChild;
    for (const desired of [...next.childNodes]) {
        const id = key(desired);
        if (id && key(current ?? {}) !== id) {
            const found = [...parent.childNodes].find((node) => key(node) === id);
            if (found) parent.insertBefore(found, current);
            else parent.insertBefore(desired.cloneNode(true), current);
            current = found ?? (current ? current.previousSibling : parent.lastChild);
        }
        if (!current) {
            parent.append(desired.cloneNode(true));
            continue;
        }
        const following = current.nextSibling;
        if (
            current.nodeType !== desired.nodeType ||
            current.nodeName !== desired.nodeName ||
            key(current) !== id
        ) {
            current.replaceWith(desired.cloneNode(true));
        } else if (current.nodeType === 3) {
            if (current.nodeValue !== desired.nodeValue) current.nodeValue = desired.nodeValue;
        } else if (current.nodeType === 1) {
            for (const attribute of [...current.attributes]) {
                // Let the native disclosure retain the user's open/closed choice.
                if (current.localName === 'details' && attribute.name === 'open') continue;
                if (!desired.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
            }
            for (const attribute of desired.attributes) {
                if (current.getAttribute(attribute.name) !== attribute.value)
                    current.setAttribute(attribute.name, attribute.value);
            }
            patchChildren(current, desired);
            if (current instanceof HTMLInputElement) {
                // Secret drafts are assigned via properties, never serialized in HTML attributes.
                if (!current.hasAttribute('data-private') && current.value !== desired.value)
                    current.value = desired.value;
                current.checked = desired.checked;
            } else if (current instanceof HTMLSelectElement && current.value !== desired.value) {
                current.value = desired.value;
            }
        }
        current = following;
    }
    while (current) {
        const nextNode = current.nextSibling;
        current.remove();
        current = nextNode;
    }
}
