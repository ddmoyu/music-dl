import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@neutralinojs/lib', () => ({
    events: { on: vi.fn(), off: vi.fn() },
    os: { spawnProcess: vi.fn(), updateSpawnedProcess: vi.fn() },
}));
import { events, os } from '@neutralinojs/lib';
import { launchService } from '../../src/service-launch.js';

let listener;
const emit = (action, data, id = 7) => listener?.({ detail: { id, action, data } });
beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    events.on.mockImplementation(async (_, handler) => {
        listener = handler;
    });
    events.off.mockImplementation(async () => {
        listener = null;
    });
    os.spawnProcess.mockResolvedValue({ id: 7, pid: 100 });
    os.updateSpawnedProcess.mockImplementation(async (id) => emit('exit', 0, id));
});
afterEach(() => {
    vi.useRealTimers();
    listener = null;
});

it('accepts a split ready report and releases only the startup listener', async () => {
    const ready = launchService('command');
    await vi.advanceTimersByTimeAsync(0);
    emit('stdOut', '{"event":"ready",', 8);
    emit('stdOut', 'unrelated output\n{"event":"rea');
    emit('stdOut', 'dy","instance_id":"instance"}\n');
    await expect(ready).resolves.toMatchObject({ instance_id: 'instance' });
    expect(os.updateSpawnedProcess).not.toHaveBeenCalled();
    expect(events.off).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
});

it('waits for termination before reporting a timeout and ignores a late ready', async () => {
    let finishKill;
    os.updateSpawnedProcess.mockImplementation(
        () =>
            new Promise((done) => {
                finishKill = done;
            }),
    );
    const ready = launchService('command', 100);
    const failure = expect(ready).rejects.toThrow('启动超时');
    let finished = false;
    void ready.catch(() => {
        finished = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(os.updateSpawnedProcess).toHaveBeenCalledWith(7, 'exit');
    expect(finished).toBe(false);
    emit('stdOut', '{"event":"ready"}\n');
    emit('exit', 0);
    finishKill();
    await failure;
    expect(events.off).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
});

it('reaps a process whose native spawn reply arrives after timeout', async () => {
    let finishSpawn;
    os.spawnProcess.mockImplementation(
        () =>
            new Promise((done) => {
                finishSpawn = done;
            }),
    );
    const ready = launchService('command', 100);
    const failure = expect(ready).rejects.toThrow('启动超时');
    await vi.advanceTimersByTimeAsync(100);
    await failure;
    finishSpawn({ id: 7 });
    await vi.advanceTimersByTimeAsync(0);
    expect(os.updateSpawnedProcess).toHaveBeenCalledWith(7, 'exit');
    expect(listener).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
});

it('cleans a malformed startup response and reports cleanup failures', async () => {
    os.updateSpawnedProcess.mockRejectedValue(new Error('kill denied'));
    const ready = launchService('command');
    const failure = expect(ready).rejects.toThrow('未能清理启动进程');
    await vi.advanceTimersByTimeAsync(0);
    emit('stdOut', 'x'.repeat(65537));
    await failure;
    expect(listener).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
});

it('removes listeners after spawn failure or an early process exit', async () => {
    os.spawnProcess.mockRejectedValueOnce(new Error('spawn failed'));
    await expect(launchService('command')).rejects.toThrow('spawn failed');
    const next = launchService('command');
    const failure = expect(next).rejects.toThrow('本机服务退出');
    await vi.advanceTimersByTimeAsync(0);
    emit('exit', 1);
    await failure;
    expect(os.updateSpawnedProcess).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
});
