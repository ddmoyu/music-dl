import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { hostTarget, releaseFiles, targets } from '../scripts/desktop-targets.js';
import { commandArgument } from '../src/command-argument.js';

it('maps exactly the five native platforms with available backend releases', () => {
    expect(Object.keys(targets)).toHaveLength(5);
    expect(new Set(releaseFiles).size).toBe(6);
    for (const [id, target] of Object.entries(targets))
        expect(hostTarget(target.platform, target.arch).id).toBe(id);
    expect(() => hostTarget('win32', 'arm64')).toThrow('未支持');
    expect(() => hostTarget('linux', 'ia32')).toThrow('未支持');
});

it('retains Windows command restrictions and supports Unicode paths', () => {
    expect(commandArgument('C:\\音乐 目录\\app.exe', 'Windows')).toBe('"C:\\音乐 目录\\app.exe"');
    for (const value of ['bad"path', '%PATH%', 'line\nnext'])
        expect(() => commandArgument(value, 'Windows')).toThrow();
});

it.skipIf(process.platform === 'win32')(
    'keeps POSIX quotes and shell metacharacters literal',
    () => {
        for (const value of [
            "/tmp/音乐 曲袋's service",
            '$(echo injected) `echo injected` %PATH% "',
        ]) {
            const actual = execFileSync(
                '/bin/sh',
                ['-c', `printf '%s' ${commandArgument(value, 'Linux')}`],
                { encoding: 'utf8' },
            );
            expect(actual).toBe(value);
        }
    },
);
