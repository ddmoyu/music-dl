import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as nodeFs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { prepareServiceConfig, serviceConfig } from '../../src/service-config.js';

let directory, fs;
beforeEach(async () => {
    directory = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'qudai-config-test-'));
    fs = {
        getJoinedPath: async (...parts) => path.join(...parts),
        readDirectory: async (dir) => (await nodeFs.readdir(dir)).map((entry) => ({ entry })),
        readFile: vi.fn((file) => nodeFs.readFile(file, 'utf8')),
        writeFile: vi.fn(nodeFs.writeFile),
        copy: vi.fn((source, target) => nodeFs.copyFile(source, target, constants.COPYFILE_EXCL)),
        remove: (file) => nodeFs.rm(file),
    };
});
afterEach(async () => {
    if (
        path.dirname(directory) !== os.tmpdir() ||
        !path.basename(directory).startsWith('qudai-config-test-')
    )
        throw new Error('Unexpected temporary path');
    await nodeFs.rm(directory, { recursive: true, force: true });
});
const prepare = () =>
    prepareServiceConfig(fs, directory, 'service-data', 'default-music', 'http://localhost');

it('creates the first config and keeps subsequent user edits intact', async () => {
    const first = await prepare();
    expect(first.downloads).toBe('default-music');
    const original = serviceConfig('old-data', 'my-music', 'http://old');
    original.control.port = 1234;
    const serialized = JSON.stringify(original, null, 2);
    await nodeFs.writeFile(path.join(directory, 'service.json'), serialized);
    const second = await prepare();
    expect(await nodeFs.readFile(path.join(directory, 'service.json'), 'utf8')).toBe(serialized);
    expect(second.downloads).toBe('my-music');
    expect(JSON.parse(await nodeFs.readFile(second.configPath, 'utf8'))).toMatchObject({
        data_dir: 'service-data',
        control: { port: 0 },
        cors: { allowed_origins: ['http://localhost'] },
    });
    expect(await nodeFs.readdir(directory)).toEqual(['launcher-config.json', 'service.json']);
});

it.each(['{broken', '{}', '{"destinations":[]}'])(
    'does not write anything when the original config is damaged: %s',
    async (serialized) => {
        const file = path.join(directory, 'service.json');
        await nodeFs.writeFile(file, serialized);
        await expect(prepare()).rejects.toThrow('原文件已保留');
        expect(fs.writeFile).not.toHaveBeenCalled();
        expect(await nodeFs.readFile(file, 'utf8')).toBe(serialized);
    },
);

it('propagates read errors without writing a default config', async () => {
    await nodeFs.writeFile(path.join(directory, 'service.json'), 'existing');
    fs.readFile.mockRejectedValueOnce(new Error('access denied'));
    await expect(prepare()).rejects.toThrow('access denied');
    expect(fs.writeFile).not.toHaveBeenCalled();
});

it('reads a config created concurrently instead of replacing it', async () => {
    const serialized = JSON.stringify(serviceConfig('data', 'racing-music', 'http://old'));
    fs.copy.mockImplementationOnce(async (_, target) => {
        await nodeFs.writeFile(target, serialized);
        throw new Error('already exists');
    });
    expect((await prepare()).downloads).toBe('racing-music');
    expect(await nodeFs.readFile(path.join(directory, 'service.json'), 'utf8')).toBe(serialized);
});

it('keeps the user config when writing the launch config fails', async () => {
    const serialized = JSON.stringify(serviceConfig('data', 'my-music', 'http://old'));
    await nodeFs.writeFile(path.join(directory, 'service.json'), serialized);
    fs.writeFile.mockRejectedValueOnce(new Error('disk full'));
    await expect(prepare()).rejects.toThrow('disk full');
    expect(await nodeFs.readFile(path.join(directory, 'service.json'), 'utf8')).toBe(serialized);
});
