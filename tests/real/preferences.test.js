import { afterEach, expect, it, vi } from 'vitest';
import { storage, filesystem as fs } from '@neutralinojs/lib';

vi.mock('../../src/desktop.js', () => ({ native: true }));
vi.mock('@neutralinojs/lib', () => {
    const values = new Map();
    const validate = (key) => {
        if (!/^[a-zA-Z-_0-9]{1,50}$/.test(key)) throw new Error('Invalid storage key format');
    };
    return {
        storage: {
            getData: vi.fn(async (key) => {
                validate(key);
                if (!values.has(key)) throw { code: 'NE_ST_NOSTKEX' };
                return values.get(key);
            }),
            setData: vi.fn(async (key, value) => {
                validate(key);
                values.set(key, value);
            }),
        },
        filesystem: {
            readDirectory: vi.fn(),
            readFile: vi.fn(),
            getJoinedPath: async (...parts) => parts.join('/'),
        },
    };
});
import { readPreferences, savePreferences } from '../../src/preferences.js';
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

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

it('accepts a genuinely absent storage folder but propagates access failures', async () => {
    vi.stubGlobal('window', { NL_PATH: 'app' });
    storage.getData.mockRejectedValueOnce({ code: 'NE_ST_NOSTKEX' });
    fs.readDirectory.mockResolvedValueOnce([]);
    expect(await readPreferences()).toEqual({});
    storage.getData.mockRejectedValueOnce({ code: 'NE_ST_NOSTKEX' });
    fs.readDirectory.mockRejectedValueOnce(new Error('access denied'));
    await expect(readPreferences()).rejects.toThrow('原文件已保留');
});

it('does not mistake an unreadable existing preference file for a missing key', async () => {
    vi.stubGlobal('window', { NL_PATH: 'app' });
    storage.getData.mockRejectedValueOnce({ code: 'NE_ST_NOSTKEX' });
    fs.readDirectory
        .mockResolvedValueOnce([{ entry: '.storage' }])
        .mockResolvedValueOnce([{ entry: 'shiyin_service_preferences.neustorage' }]);
    fs.readFile.mockRejectedValueOnce(new Error('access denied'));
    const writes = storage.setData.mock.calls.length;
    await expect(readPreferences()).rejects.toThrow('原文件已保留');
    expect(storage.setData.mock.calls.length).toBe(writes);
});

it.each([
    '',
    '{broken',
    'null',
    '[]',
    '{"hidden":"bad"}',
    '{"pending":{"key":"k","route":"/bad"}}',
])('preserves invalid preferences instead of resetting them: %s', async (serialized) => {
    storage.getData.mockResolvedValueOnce(serialized);
    const writes = storage.setData.mock.calls.length;
    await expect(readPreferences()).rejects.toThrow('原文件已保留');
    expect(storage.setData.mock.calls.length).toBe(writes);
});
