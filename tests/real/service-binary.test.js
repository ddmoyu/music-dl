import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as nodeFs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

vi.mock('@neutralinojs/lib', () => ({
    filesystem: {
        getJoinedPath: async (...parts) => path.join(...parts),
        getStats: async (file) => {
            const stats = await nodeFs.stat(file);
            return { size: stats.size, isFile: stats.isFile(), isDirectory: stats.isDirectory() };
        },
        readBinaryFile: nodeFs.readFile,
        createDirectory: async (directory) => {
            // Match Neutralino's native API: existing directories report an error.
            if (!(await nodeFs.mkdir(directory, { recursive: true })))
                throw new Error('NE_FS_DIRCRER');
        },
        move: async (source, destination) => {
            // Match Windows std::filesystem::rename, which does not replace a file.
            if (await nodeFs.stat(destination).catch(() => null)) throw new Error('NE_FS_MOVEERR');
            await nodeFs.rename(source, destination);
        },
        remove: (file) => nodeFs.rm(file, { force: true }),
    },
    resources: { extractFile: vi.fn() },
}));
import { resources } from '@neutralinojs/lib';
import { resolveServiceBinary } from '../../src/service-binary.js';

const payload = Buffer.from('test service binary');
const manifest = {
    sha256: createHash('sha256').update(payload).digest('hex'),
    size: payload.length,
};
const context = { NL_OS: 'Windows', NL_SHIYIN_SERVICE: manifest };
let directory;

beforeEach(async () => {
    directory = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'shiyin-binary-test-'));
    resources.extractFile.mockReset();
    resources.extractFile.mockImplementation((_, destination) =>
        nodeFs.writeFile(destination, payload),
    );
});
afterEach(async () => {
    if (
        path.dirname(directory) !== os.tmpdir() ||
        !path.basename(directory).startsWith('shiyin-binary-test-')
    )
        throw new Error('Unexpected temporary path');
    await nodeFs.rm(directory, { recursive: true, force: true });
});

it('extracts a verified binary once and reuses the content-addressed cache', async () => {
    const binary = await resolveServiceBinary(directory, context);
    expect(await nodeFs.readFile(binary)).toEqual(payload);
    expect(await resolveServiceBinary(directory, context)).toBe(binary);
    expect(resources.extractFile).toHaveBeenCalledTimes(1);
    expect(await nodeFs.readdir(path.dirname(binary))).toEqual(['music-service.exe']);
});

it('repairs a corrupted cache even when its file size has not changed', async () => {
    const binary = await resolveServiceBinary(directory, context);
    await nodeFs.writeFile(binary, Buffer.alloc(payload.length));
    await resolveServiceBinary(directory, context);
    expect(await nodeFs.readFile(binary)).toEqual(payload);
    expect(resources.extractFile).toHaveBeenCalledTimes(2);
});

it('does not publish a damaged extraction and cleans the temporary file', async () => {
    resources.extractFile.mockImplementation((_, destination) =>
        nodeFs.writeFile(destination, Buffer.alloc(payload.length)),
    );
    await expect(resolveServiceBinary(directory, context)).rejects.toThrow('校验失败');
    expect(await nodeFs.readdir(path.join(directory, 'runtime', manifest.sha256))).toEqual([]);
});

it('keeps an older service binary intact when the embedded service changes', async () => {
    const oldBinary = await resolveServiceBinary(directory, context);
    const newer = Buffer.from('new service version');
    resources.extractFile.mockImplementation((_, destination) =>
        nodeFs.writeFile(destination, newer),
    );
    const newBinary = await resolveServiceBinary(directory, {
        ...context,
        NL_SHIYIN_SERVICE: {
            sha256: createHash('sha256').update(newer).digest('hex'),
            size: newer.length,
        },
    });
    expect(newBinary).not.toBe(oldBinary);
    expect(await nodeFs.readFile(oldBinary)).toEqual(payload);
    expect(await nodeFs.readFile(newBinary)).toEqual(newer);
});

it('rejects an invalid packaged manifest instead of using an external executable', async () => {
    await expect(
        resolveServiceBinary(directory, { ...context, NL_SHIYIN_SERVICE: { sha256: '../escape' } }),
    ).rejects.toThrow('信息无效');
    expect(resources.extractFile).not.toHaveBeenCalled();
});

it('uses the explicitly provisioned binary during development', async () => {
    expect(await resolveServiceBinary(directory, { NL_OS: 'Windows', NL_PATH: directory })).toBe(
        path.join(directory, 'bin', 'service', 'music-service.exe'),
    );
    expect(resources.extractFile).not.toHaveBeenCalled();
});
