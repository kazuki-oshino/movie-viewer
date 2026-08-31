import { describe, expect, it, vi } from 'vitest';
import { SaveQueue } from './saveQueue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('保存キュー', () => {
  it('書き込みを直列化し、待機中は最新の再生位置だけを残す', async () => {
    const gate = deferred();
    const save = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue(undefined);
    const status = vi.fn();
    const queue = new SaveQueue(save, status);
    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    expect(save).toHaveBeenCalledTimes(1);
    gate.resolve();
    await queue.flush();
    expect(save.mock.calls).toEqual([
      [1, 1],
      [3, 3],
    ]);
    expect(status).toHaveBeenLastCalledWith('saved');
  });
  it('失敗時に最新の状態を保持し、明示した再試行で保存する', async () => {
    const failure = new Error('disk full');
    const save = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const status = vi.fn();
    const queue = new SaveQueue(save, status);
    queue.enqueue(8);
    await expect(queue.flush()).rejects.toThrow('disk full');
    queue.enqueue(12);
    expect(save).toHaveBeenCalledTimes(1);
    await queue.flush();
    expect(save).toHaveBeenLastCalledWith(12, 2);
    expect(status).toHaveBeenLastCalledWith('saved');
  });
  it('終了時のflushは実際の書き込み完了まで待つ', async () => {
    const gate = deferred();
    const queue = new SaveQueue(() => gate.promise, vi.fn());
    let finished = false;
    queue.enqueue(1);
    const flush = queue.flush().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    gate.resolve();
    await flush;
    expect(finished).toBe(true);
  });
});
