export function commandArgument(value, platform) {
    if (typeof value !== 'string' || /[\0\r\n]/.test(value))
        throw new Error('应用路径包含不支持的字符');
    if (platform === 'Windows') {
        if (/["%`$]/.test(value)) throw new Error('应用路径包含不支持的字符');
        return `"${value}"`;
    }
    return `'${value.replaceAll("'", "'\\''")}'`;
}
