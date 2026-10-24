import { storage } from '@neutralinojs/lib';
import { native } from './desktop.js';
// Neutralino storage keys only permit letters, digits, underscores and hyphens.
const key = native ? 'shiyin_real_v1' : 'shiyin.real.v1';
export async function readPreferences() {
    try {
        return JSON.parse(native ? await storage.getData(key) : localStorage.getItem(key)) || {};
    } catch {
        return {};
    }
}
export async function savePreferences(value) {
    const serialized = JSON.stringify(value);
    if (native) await storage.setData(key, serialized);
    else localStorage.setItem(key, serialized);
}
