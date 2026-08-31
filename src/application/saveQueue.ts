export type SaveStatus = 'saved' | 'saving' | 'failed';

/** Serial, coalesced writes. The latest value survives failure for an explicit retry. */
export class SaveQueue<T> {
  private revision = 0;
  private pending: { value: T; revision: number } | null = null;
  private running: Promise<void> | null = null;
  private lastError: unknown = null;

  constructor(
    private readonly save: (value: T, revision: number) => Promise<unknown>,
    private readonly onStatus: (status: SaveStatus, error?: unknown) => void,
  ) {}

  enqueue(value: T) {
    this.pending = { value, revision: ++this.revision };
    // A disk failure must not cause continuous retries on every timeupdate.
    if (!this.lastError) this.start();
  }

  async flush() {
    this.lastError = null;
    if (this.pending) this.start();
    while (this.running) {
      await this.running;
      if (this.lastError) throw this.lastError;
    }
    if (this.lastError) throw this.lastError;
  }

  private start() {
    if (this.running) return;
    this.onStatus('saving');
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.pending && !this.lastError) this.start();
    });
  }

  private async drain() {
    while (this.pending) {
      const next = this.pending;
      this.pending = null;
      try {
        await this.save(next.value, next.revision);
      } catch (error) {
        this.pending ??= next;
        this.lastError = error;
        this.onStatus('failed', error);
        return;
      }
    }
    this.onStatus('saved');
  }
}
