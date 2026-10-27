export const targets = {
    'windows-x64': {
        platform: 'win32',
        arch: 'x64',
        os: 'Windows',
        runner: 'windows-2025',
        runtime: 'neutralino-win_x64.exe',
        runtimeSlot: 'neutralino-win_x64.exe',
        neuBinary: 'qudai-win_x64.exe',
        backend: 'windows-x86_64.zip',
        assets: ['qudai-win_x64.exe', 'qudai-windows-x64.zip'],
    },
    'linux-x64': {
        platform: 'linux',
        arch: 'x64',
        os: 'Linux',
        runner: 'ubuntu-24.04',
        runtime: 'neutralino-linux_x64',
        runtimeSlot: 'neutralino-linux_x64',
        neuBinary: 'qudai-linux_x64',
        backend: 'linux-x86_64.tar.gz',
        assets: ['qudai-linux-x64.deb', 'qudai-linux-x64.AppImage'],
    },
    'linux-arm64': {
        platform: 'linux',
        arch: 'arm64',
        os: 'Linux',
        runner: 'ubuntu-24.04-arm',
        runtime: 'neutralino-linux_arm64',
        runtimeSlot: 'neutralino-linux_arm64',
        neuBinary: 'qudai-linux_arm64',
        backend: 'linux-arm64.tar.gz',
        assets: ['qudai-linux-arm64.deb', 'qudai-linux-arm64.AppImage'],
    },
    'macos-x64': {
        platform: 'darwin',
        arch: 'x64',
        os: 'Darwin',
        runner: 'macos-15-intel',
        runtime: 'neutralino-mac_x64',
        runtimeSlot: 'neutralino-mac_universal',
        neuBinary: 'qudai-mac_universal',
        backend: 'macos-x86_64.tar.gz',
        assets: ['qudai-macos-x64.dmg'],
    },
    'macos-arm64': {
        platform: 'darwin',
        arch: 'arm64',
        os: 'Darwin',
        runner: 'macos-15',
        runtime: 'neutralino-mac_arm64',
        runtimeSlot: 'neutralino-mac_universal',
        neuBinary: 'qudai-mac_universal',
        backend: 'macos-arm64.tar.gz',
        assets: ['qudai-macos-arm64.dmg'],
    },
};

export function hostTarget(platform = process.platform, arch = process.arch) {
    const entry = Object.entries(targets).find(
        ([, target]) => target.platform === platform && target.arch === arch,
    );
    if (!entry) throw new Error(`未支持的桌面目标：${platform}/${arch}`);
    return { id: entry[0], ...entry[1] };
}

export const releaseFiles = Object.values(targets).flatMap((target) => target.assets);
