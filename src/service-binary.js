import { filesystem as fs, resources } from '@neutralinojs/lib';

const digest = async (data) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (byte) =>
        byte.toString(16).padStart(2, '0'),
    ).join('');

export async function resolveServiceBinary(directory, context = window) {
    const manifest = context.NL_SHIYIN_SERVICE;
    if (manifest === undefined) {
        const executable = context.NL_OS === 'Windows' ? 'music-service.exe' : 'music-service';
        return fs.getJoinedPath(context.NL_PATH, 'bin', 'service', executable);
    }
    if (
        context.NL_OS !== 'Windows' ||
        !/^[a-f0-9]{64}$/.test(manifest?.sha256) ||
        !Number.isSafeInteger(manifest?.size) ||
        manifest.size <= 0
    )
        throw new Error('内置服务信息无效，请重新下载应用');

    const cache = await fs.getJoinedPath(directory, 'runtime', manifest.sha256);
    const binary = await fs.getJoinedPath(cache, 'music-service.exe');
    const valid = async (file) => {
        try {
            const stats = await fs.getStats(file);
            return (
                stats.isFile &&
                stats.size === manifest.size &&
                (await digest(await fs.readBinaryFile(file))) === manifest.sha256
            );
        } catch {
            return false;
        }
    };
    if (await valid(binary)) return binary;
    try {
        await fs.createDirectory(cache);
    } catch (error) {
        // Neutralino reports an error for an existing directory, including extraction races.
        if (!(await fs.getStats(cache)).isDirectory) throw error;
    }
    const temporary = await fs.getJoinedPath(cache, `service-${crypto.randomUUID()}.tmp`);
    try {
        await resources.extractFile('/dist/app/service/music-service.exe', temporary);
        if (!(await valid(temporary))) throw new Error('内置服务校验失败，请重新下载应用');
        // A concurrent launcher may have finished extracting the same binary.
        if (!(await valid(binary))) {
            try {
                const existing = await fs.getStats(binary).catch(() => null);
                if (existing) {
                    if (!existing.isFile) throw new Error('服务缓存路径被占用');
                    // Windows rename cannot overwrite an existing file. Only replace a
                    // verified-invalid executable after the replacement has been checked.
                    await fs.remove(binary);
                }
                await fs.move(temporary, binary);
            } catch (error) {
                if (!(await valid(binary))) throw error;
            }
        }
        return binary;
    } finally {
        await fs.remove(temporary).catch(() => {});
    }
}
