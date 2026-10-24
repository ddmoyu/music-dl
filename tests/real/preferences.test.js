import { expect, it, vi } from 'vitest';

vi.mock('../../src/desktop.js', () => ({ native: true }));
vi.mock('@neutralinojs/lib', () => {
    const values = new Map();
    const validate = (key) => {
        if (!/^[a-zA-Z-_0-9]{1,50}$/.test(key)) throw new Error('Invalid storage key format');
    };
    return {
        storage: {
            getData: async (key) => {
                validate(key);
                return values.get(key) || '';
            },
            setData: async (key, value) => {
                validate(key);
                values.set(key, value);
            },
        },
    };
});
import { readPreferences, savePreferences } from '../../src/preferences.js';

it('persists download recovery data using a valid native storage key', async () => {
    const value = {
        settings: { quality: 'standard' },
        pending: { key: 'idempotency-key', route: '/download-batches', body: { items: [] } },
    };
    await savePreferences(value);
    expect(await readPreferences()).toEqual(value);
    await savePreferences({ ...value, pending: null });
    expect((await readPreferences()).pending).toBeNull();
});
