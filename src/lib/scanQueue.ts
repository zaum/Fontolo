// Coalesce requests made during a task into one trailing run. Every caller
// waits for the newest run, and obsolete results can be rejected at commit time.
export class ScanQueue {
  private revision = 0;
  private running: Promise<void> | null = null;

  constructor(private readonly run: (isCurrent: () => boolean) => Promise<void>) {}

  request(): Promise<void> {
    this.revision++;
    if (!this.running) {
      this.running = Promise.resolve().then(async () => {
        try {
          let version: number;
          do {
            version = this.revision;
            await this.run(() => version === this.revision);
          } while (version !== this.revision);
        } finally {
          this.running = null;
        }
      });
    }
    return this.running;
  }
}
