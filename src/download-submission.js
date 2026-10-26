export class DownloadSubmission {
    constructor(api, persist, pending = null) {
        this.api = api;
        this.persist = persist;
        this.pending = pending;
    }
    async submit(pending) {
        if (this.pending) throw new Error('请先确认上次提交结果');
        this.pending = pending;
        try {
            await this.persist();
        } catch (cause) {
            this.pending = null;
            throw new Error('无法保存下载记录，任务尚未提交。请检查应用数据目录的写入权限。', {
                cause,
            });
        }
        await this.confirm();
    }
    async confirm() {
        if (!this.pending) return;
        const pending = this.pending;
        try {
            await this.api.request(pending.route, {
                method: 'POST',
                body: pending.body,
                key: pending.key,
            });
        } catch (error) {
            if (
                error.status &&
                error.status < 500 &&
                error.status !== 408 &&
                error.status !== 429
            ) {
                this.pending = null;
                await this.persist().catch(() => {});
            }
            throw error;
        }
        this.pending = null;
        try {
            await this.persist();
        } catch (cause) {
            throw new Error('任务已提交，但本地记录保存失败。请到下载任务查看进度。', { cause });
        }
    }
}
