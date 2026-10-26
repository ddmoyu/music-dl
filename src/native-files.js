// 先枚举父目录确认缺失，避免把 Neutralino 合并后的读取错误误当作首次运行。
export async function readOptionalFile(fs, directory, name) {
    const entries = await fs.readDirectory(directory);
    if (!entries.some((entry) => entry.entry.toLowerCase() === name.toLowerCase())) return null;
    return fs.readFile(await fs.getJoinedPath(directory, name));
}

export async function ensureDirectory(fs, directory) {
    try {
        await fs.createDirectory(directory);
    } catch (error) {
        if (!(await fs.getStats(directory)).isDirectory) throw error;
    }
}
