import { providers } from './providers.js';
export const cookieProviders = providers.filter((provider) => provider.cookie);

// This checks pasted Cookie header syntax only, never account validity.
export function parseCookie(raw) {
    const value = raw
        .trim()
        .replace(/^cookie\s*:\s*/i, '')
        .trim();
    if (!value) return { error: '请先填写 Cookie' };
    if (new TextEncoder().encode(value).length > 65536)
        return { error: 'Cookie 内容过长，请检查是否复制了其他请求信息' };
    if (/[\x00-\x1f\x7f]/.test(value))
        return { error: '请只粘贴 Cookie 字符串，不要包含其他请求头或换行' };
    const parts = value
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean);
    if (!parts.length || parts.some((part) => !/^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+=/.test(part)))
        return { error: '格式应为 name=value; name2=value2，请复制 Cookie 请求头的内容' };
    return { value: parts.join('; ') };
}
