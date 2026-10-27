import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { Logger } from '@nestjs/common';
import { stopChildProcess } from './restore-strategy.interface';

describe('stopChildProcess', () => {
  let child: EventEmitter & { kill: jest.Mock; pid: number; exitCode: null; signalCode: null };
  let resolved: boolean;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    child = Object.assign(new EventEmitter(), { kill: jest.fn(), pid: 4242, exitCode: null, signalCode: null });
    resolved = false;
    void stopChildProcess(child as unknown as ChildProcess, 5_000, 5_000).then(() => {
      resolved = true;
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
  });

  it('resolves when the child exits after SIGTERM, without killing it or warning', async () => {
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('exit', null, 'SIGTERM');
    await jest.advanceTimersByTimeAsync(60_000);

    expect(resolved).toBe(true);
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
    expect(warn).not.toHaveBeenCalled();
  });

  it('sends SIGKILL after the grace, and keeps waiting for a child that survives it, warning once', async () => {
    await jest.advanceTimersByTimeAsync(4_999);
    expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
    await jest.advanceTimersByTimeAsync(1);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(resolved).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('4242'));

    child.emit('close', null);
    await jest.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });
});
