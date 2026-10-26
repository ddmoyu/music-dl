import { afterEach, expect, it, vi } from 'vitest';
import { watchTasks } from '../../src/tasks.js';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
it('parses split authenticated events, synchronizes missed changes and stops reconnecting', async () => {
    vi.useFakeTimers();
    const streams = [],
        aborts = [];
    const fetcher = vi.fn(async (_, options) => {
        expect(options.headers).toEqual({ Authorization: 'Bearer secret' });
        return new Response(
            new ReadableStream({
                start(controller) {
                    streams.push(controller);
                    const abort = () => controller.close();
                    aborts.push(abort);
                    options.signal.addEventListener('abort', abort, { once: true });
                },
            }),
        );
    });
    vi.stubGlobal('fetch', fetcher);
    const synchronize = vi.fn().mockResolvedValue(false);
    const receive = vi.fn(),
        report = vi.fn();
    const stop = watchTasks(
        { session: { token: 'secret', events_base_url: 'http://localhost' } },
        synchronize,
        report,
        receive,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(synchronize).toHaveBeenCalledOnce();
    const encoder = new TextEncoder();
    streams[0].enqueue(encoder.encode('event: task.up'));
    streams[0].enqueue(encoder.encode('dated\r\ndata: {"task_id":"task","version":2}\r\n\r'));
    streams[0].enqueue(encoder.encode('\n'));
    await vi.advanceTimersByTimeAsync(250);
    expect(receive).toHaveBeenCalledWith({ task_id: 'task', version: 2 });
    expect(synchronize).toHaveBeenCalledTimes(2);
    fetcher.mock.calls[0][1].signal.removeEventListener('abort', aborts[0]);
    streams[0].close();
    await vi.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledWith('实时连接中断，正在重连');
    expect(receive).toHaveBeenCalledWith({ poll: true });
    await vi.advanceTimersByTimeAsync(2500);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(receive.mock.calls.filter(([event]) => event === null)).toHaveLength(2);
    stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
});

it('coalesces events received during synchronization without overlapping requests', async () => {
    vi.useFakeTimers();
    let controller, finish;
    vi.stubGlobal(
        'fetch',
        vi.fn(
            async (_, options) =>
                new Response(
                    new ReadableStream({
                        start(value) {
                            controller = value;
                            options.signal.addEventListener('abort', () => controller.close(), {
                                once: true,
                            });
                        },
                    }),
                ),
        ),
    );
    const synchronize = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        )
        .mockResolvedValue(false);
    const stop = watchTasks(
        { session: { events_base_url: 'http://localhost', token: 'secret' } },
        synchronize,
        vi.fn(),
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.enqueue(new TextEncoder().encode('event: stream.ready\n\n'));
    await vi.advanceTimersByTimeAsync(250);
    expect(synchronize).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 20; i++)
        controller.enqueue(new TextEncoder().encode('event: stream.ready\n\n'));
    await vi.advanceTimersByTimeAsync(250);
    expect(synchronize).toHaveBeenCalledTimes(2);
    finish(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(synchronize).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
});
