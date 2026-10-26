import { expect, it, vi } from 'vitest';
import { DownloadSubmission } from '../../src/download-submission.js';

const pending = () => ({ key: 'original-key', route: '/download-batches', body: { items: [] } });
it('does not submit or retain an uncertain request when its first save fails', async () => {
    const api = { request: vi.fn() };
    const submission = new DownloadSubmission(
        api,
        vi.fn().mockRejectedValue(new Error('disk full')),
    );
    await expect(submission.submit(pending())).rejects.toThrow('任务尚未提交');
    expect(submission.pending).toBeNull();
    expect(api.request).not.toHaveBeenCalled();
});

it('persists before sending and replays the same request after a lost response', async () => {
    const api = {
        request: vi
            .fn()
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValue({ data: {} }),
    };
    let persisted;
    const submission = new DownloadSubmission(api, async () => {
        persisted = structuredClone(submission.pending);
    });
    await expect(submission.submit(pending())).rejects.toThrow('network');
    expect(persisted).toEqual(pending());
    const recovered = new DownloadSubmission(api, async () => {}, persisted);
    await expect(recovered.submit({ ...pending(), key: 'another-key' })).rejects.toThrow(
        '请先确认',
    );
    await recovered.confirm();
    expect(api.request.mock.calls[0]).toEqual(api.request.mock.calls[1]);
    expect(api.request.mock.calls[0][1].key).toBe('original-key');
    expect(recovered.pending).toBeNull();
});

it('reports an accepted request distinctly when clearing the local record fails', async () => {
    const api = { request: vi.fn().mockResolvedValue({ data: {} }) };
    const save = vi.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error('disk full'));
    const submission = new DownloadSubmission(api, save);
    await expect(submission.submit(pending())).rejects.toThrow('任务已提交');
    expect(api.request).toHaveBeenCalledOnce();
    expect(submission.pending).toBeNull();
});

it.each([400, 408, 429, 503])(
    'keeps only uncertain failures pending for status %s',
    async (status) => {
        const api = {
            request: vi.fn().mockRejectedValue(Object.assign(new Error('failed'), { status })),
        };
        const submission = new DownloadSubmission(api, async () => {});
        await expect(submission.submit(pending())).rejects.toThrow('failed');
        expect(submission.pending).toEqual(status === 400 ? null : pending());
    },
);
