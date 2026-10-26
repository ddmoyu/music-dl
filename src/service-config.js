import { readOptionalFile } from './native-files.js';

export async function prepareServiceConfig(fs, directory, dataDir, defaultDownloads, origin) {
    const configPath = await fs.getJoinedPath(directory, 'service.json');
    let serialized = await readOptionalFile(fs, directory, 'service.json');
    if (serialized === null) {
        const temporary = await fs.getJoinedPath(directory, `config-${crypto.randomUUID()}.tmp`);
        try {
            await fs.writeFile(
                temporary,
                JSON.stringify(serviceConfig(dataDir, defaultDownloads, origin)),
            );
            try {
                // 独占创建；另一个启动者已经创建配置时，读取它而不覆盖。
                await fs.copy(temporary, configPath, { overwrite: false });
            } catch (error) {
                serialized = await readOptionalFile(fs, directory, 'service.json');
                if (serialized === null) throw error;
            }
        } finally {
            await fs.remove(temporary).catch(() => {});
        }
        serialized ??= await fs.readFile(configPath);
    }
    let previous;
    try {
        previous = JSON.parse(serialized);
        if (
            !previous ||
            typeof previous !== 'object' ||
            Array.isArray(previous) ||
            !Array.isArray(previous.destinations) ||
            !previous.destinations.length ||
            previous.destinations.some(
                (destination) =>
                    !destination ||
                    typeof destination.root !== 'string' ||
                    !destination.root.trim(),
            )
        )
            throw new Error('下载目录配置无效');
    } catch (cause) {
        throw new Error('service.json 已损坏或下载目录配置无效，原文件已保留，请修复后重新连接', {
            cause,
        });
    }
    const downloads = previous.destinations[0].root;
    const defaults = serviceConfig(dataDir, downloads, origin);
    const config = { ...defaults, ...previous, data_dir: dataDir, cors: defaults.cors };
    config.features = { ...previous.features, ...defaults.features };
    for (const listener of ['control', 'media', 'events'])
        config[listener] = { ...previous[listener], ...defaults[listener] };
    const launchPath = await fs.getJoinedPath(directory, 'launcher-config.json');
    await fs.writeFile(launchPath, JSON.stringify(config));
    return { configPath: launchPath, downloads };
}

export function serviceConfig(dataDir, downloadDir, origin) {
    return {
        config_version: 1,
        data_dir: dataDir,
        control: { host: '127.0.0.1', port: 0 },
        media: { host: '127.0.0.1', port: 0 },
        events: { host: '127.0.0.1', port: 0 },
        features: { media_proxy: true },
        cors: { allowed_origins: [origin] },
        destinations: [
            { id: 'dst_default', name: '音乐', root: downloadDir, principals: ['prn_local'] },
        ],
    };
}
