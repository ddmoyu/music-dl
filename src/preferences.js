import { storage, filesystem as fs } from '@neutralinojs/lib';
import { native } from './desktop.js';
import { readOptionalFile } from './native-files.js';
import { SERVICE_DATA_DIRECTORY } from './service-version.js';
// Neutralino storage keys only permit letters, digits, underscores and hyphens.
const key = `shiyin_${SERVICE_DATA_DIRECTORY}_preferences`;
export async function readPreferences() {
    try {
        let serialized;
        if (native) {
            try {
                serialized = await storage.getData(key);
            } catch (error) {
                if (error.code !== 'NE_ST_NOSTKEX') throw error;
                const entries = await fs.readDirectory(window.NL_PATH);
                if (!entries.some((entry) => entry.entry.toLowerCase() === '.storage')) return {};
                const directory = await fs.getJoinedPath(window.NL_PATH, '.storage');
                serialized = await readOptionalFile(fs, directory, `${key}.neustorage`);
            }
        } else serialized = localStorage.getItem(key);
        if (serialized === null) return {};
        const value = JSON.parse(serialized);
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('偏好格式无效');
        if (
            value.settings !== undefined &&
            (!value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings))
        )
            throw new Error('设置格式无效');
        if (
            value.hidden !== undefined &&
            (!Array.isArray(value.hidden) || value.hidden.some((id) => typeof id !== 'string'))
        )
            throw new Error('任务隐藏记录格式无效');
        if (
            value.names !== undefined &&
            (!value.names || typeof value.names !== 'object' || Array.isArray(value.names))
        )
            throw new Error('任务名称格式无效');
        if (
            value.pending != null &&
            (typeof value.pending !== 'object' ||
                typeof value.pending.key !== 'string' ||
                !value.pending.key.trim() ||
                !/^\/(download-batches|downloads\/[^/]+\/retry)$/.test(value.pending.route) ||
                (value.pending.route === '/download-batches' &&
                    !Array.isArray(value.pending.body?.items)))
        )
            throw new Error('待确认下载记录格式无效');
        return value;
    } catch (error) {
        throw new Error(
            '无法读取下载偏好与待确认记录，原文件已保留。请检查存储权限或恢复损坏的偏好文件后重新连接。',
            { cause: error },
        );
    }
}
export async function savePreferences(value) {
    const serialized = JSON.stringify(value);
    if (native) await storage.setData(key, serialized);
    else localStorage.setItem(key, serialized);
}
