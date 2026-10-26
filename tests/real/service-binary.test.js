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
        access: vi.fn(async () => {}),
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
import { resources, filesystem as nativeFs } from '@neutralinojs/lib';
import { resolveServiceBinary } from '../../src/service-binary.js';
import { SERVICE_VERSION } from '../../src/service-version.js';

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
    nativeFs.access.mockReset().mockResolvedValue(undefined);
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
        path.join(directory, 'bin', 'service', SERVICE_VERSION, 'music-service.exe'),
    );
    expect(resources.extractFile).not.toHaveBeenCalled();
});

async function sidecar(os = 'Darwin') {
    const binary = path.join(directory, 'service/bin/music-service');
    const library = path.join(directory, 'service/lib/libc++.dylib');
    await nodeFs.mkdir(path.dirname(binary), { recursive: true });
    await nodeFs.mkdir(path.dirname(library), { recursive: true });
    await nodeFs.writeFile(binary, payload);
    await nodeFs.writeFile(library, payload);
    return {
        binary,
        library,
        context: {
            NL_OS: os,
            NL_PATH: directory,
            NL_SHIYIN_SERVICE: {
                mode: 'sidecar',
                os,
                files: ['bin/music-service', 'lib/libc++.dylib'].map((name) => ({
                    path: name,
                    ...manifest,
                })),
            },
        },
    };
}

it.each(['Darwin', 'Linux'])(
    'validates the complete %s service bundle without modifying the app',
    async (os) => {
        const fixture = await sidecar(os);
        expect(await resolveServiceBinary(directory, fixture.context)).toBe(fixture.binary);
        expect(nativeFs.access).toHaveBeenCalledWith(fixture.binary, 1);
        expect(resources.extractFile).not.toHaveBeenCalled();
        expect(await nodeFs.readFile(fixture.library)).toEqual(payload);
    },
);

it('refuses a damaged companion library even if the service executable is intact', async () => {
    const fixture = await sidecar();
    await nodeFs.writeFile(fixture.library, Buffer.alloc(payload.length));
    await expect(resolveServiceBinary(directory, fixture.context)).rejects.toThrow(
        '运行库校验失败',
    );
});

it('checks all sidecar paths before accessing files and rejects platform mismatches', async () => {
    const fixture = await sidecar();
    for (const name of ['../outside', 'bin/../escape', '/absolute', 'lib//file', 'bin\\escape']) {
        fixture.context.NL_SHIYIN_SERVICE.files[1].path = name;
        await expect(resolveServiceBinary(directory, fixture.context)).rejects.toThrow('信息无效');
    }
    fixture.context.NL_OS = 'Windows';
    await expect(resolveServiceBinary(directory, fixture.context)).rejects.toThrow('信息无效');
});

it('reports missing execute permissions instead of pretending that startup succeeded', async () => {
    const fixture = await sidecar();
    nativeFs.access.mockRejectedValue(new Error('permission denied'));
    await expect(resolveServiceBinary(directory, fixture.context)).rejects.toThrow(
        'permission denied',
    );
});
