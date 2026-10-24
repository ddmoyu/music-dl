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
