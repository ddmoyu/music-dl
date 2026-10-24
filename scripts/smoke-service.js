import { fork } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { Api, downloadIntent } from '../src/api.js';
import { collectionPage } from '../src/catalog.js';
const directory = path.resolve('.desktop-build', `integration-${Date.now()}`);
await mkdir(directory, { recursive: true });
const worker = fork(path.resolve('scripts/service-worker.js'), {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
});
const session = await new Promise((resolve, reject) => {
    worker.once('message', (message) =>
        message.error ? reject(Error(message.error)) : resolve(message.session),
    );
    worker.once('error', reject);
    worker.once('exit', (code) => reject(Error(`worker exited ${code}`)));
    worker.send({
        binary: path.resolve('bin/service/music-service.exe'),
        directory,
        origin: 'http://127.0.0.1:5175',
    });
});
const api = new Api(session);
try {
    const providers = (await api.request('/providers', { query: { limit: 100 } })).data.items;
    assert.equal(providers.length, 9);
    console.log('PASS: 9 providers, authenticated service');
    const charts = await collectionPage(api, '/charts', { source: 'kuwo' })(
        null,
        new AbortController().signal,
    );
    assert(charts.items.length > 0);
    const recommendations = await collectionPage(api, '/recommendations/playlists', {
        source: 'kuwo',
    })(null, new AbortController().signal);
    assert(recommendations.items.length > 0);
    assert(recommendations.nextCursor);
    const next = await collectionPage(api, '/recommendations/playlists', { source: 'kuwo' })(
        recommendations.nextCursor,
        new AbortController().signal,
    );
    assert(next.items.length > 0);
    console.log('PASS: live charts, recommendations and opaque continuation');
    const parsed = (
        await api.request('/links/parse', {
            method: 'POST',
            body: { text: 'https://www.kuwo.cn/play_detail/228908' },
        })
    ).data;
    assert.equal(parsed.matched, true);
    const track = (await api.request('/tracks/detail', { query: parsed.ref })).data;
    const asset = (
        await api.request('/assets/resolve', {
            method: 'POST',
            body: {
                track: track.ref,
                quality: 'standard',
                quality_policy: 'allow_lower',
                allow_preview: true,
            },
        })
    ).data;
    const media = (
        await api.request('/media-access', {
            method: 'POST',
            body: {
                target: { kind: 'asset', id: asset.asset_id },
                mode: 'auto',
                auth: 'ticket',
                ttl_seconds: 60,
            },
        })
    ).data;
    const preview = await fetch(media.url, {
        headers: { Range: 'bytes=0-16383' },
        signal: AbortSignal.timeout(30000),
    });
    assert(preview.ok, `preview media status: ${preview.status}`);
    const previewReader = preview.body.getReader();
    const audioChunk = await previewReader.read();
    assert(audioChunk.value?.byteLength > 0);
    await previewReader.cancel();
    console.log('PASS: real preview resolution, media ticket and audio bytes');
    await api.request('/admin/download-policy', { method: 'PATCH', body: { paused: true } });
    const body = {
            items: [
                downloadIntent(track, {
                    quality: 'standard',
                    qualityPolicy: 'allow_lower',
                    destination: 'dst_default',
                }),
            ],
        },
        key = crypto.randomUUID();
    const created = (await api.request('/download-batches', { method: 'POST', body, key })).data;
    const replay = (await api.request('/download-batches', { method: 'POST', body, key })).data;
    assert.equal(created.batch_id, replay.batch_id);
    assert.equal(created.items[0].task_id, replay.items[0].task_id);
    const id = created.items[0].task_id;
    await api.request(`/downloads/${id}/cancel`, { method: 'POST' });
    assert.equal((await api.request(`/downloads/${id}`)).data.status, 'canceled');
    const retried = (
        await api.request(`/downloads/${id}/retry`, { method: 'POST', key: crypto.randomUUID() })
    ).data;
    assert(retried.task_id && retried.task_id !== id);
    console.log('PASS: batch idempotency, queued cancellation and retry');
    const events = await fetch(session.events_base_url + '/events/v1/downloads', {
        headers: { Authorization: 'Bearer ' + session.token },
        signal: AbortSignal.timeout(10000),
    });
    assert.equal(events.status, 200);
    const reader = events.body.getReader();
    const first = await reader.read();
    assert(new TextDecoder().decode(first.value).includes('stream.ready'));
    await reader.cancel();
    console.log('PASS: authenticated SSE stream');
    await api.request('/admin/download-policy', { method: 'PATCH', body: { paused: false } });
    let final;
    for (let i = 0; i < 90; i++) {
        final = (await api.request(`/downloads/${retried.task_id}`)).data;
        if (['completed', 'failed', 'canceled'].includes(final.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.equal(
        final.status,
        'completed',
        `actual download: ${final.status}, ${final.error?.code}`,
    );
    assert(final.result.file_id);
    const file = (await api.request(`/files/${final.result.file_id}`)).data;
    console.log('PASS: actual download completed; published file verified', Object.keys(file));
    console.log('Integration data:', directory);
} finally {
    worker.disconnect();
}
let stopped = false;
for (let i = 0; i < 70; i++) {
    try {
        await fetch(session.api_base_url + '/health/ready', { signal: AbortSignal.timeout(500) });
    } catch {
        stopped = true;
        break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
}
assert(stopped, 'service must exit when its parent exits');
console.log('PASS: service shuts down when launcher exits');
