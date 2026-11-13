// One queue is created per Sandbox. It serializes updates across all files so
// that atomic fence reads do not race each other. Only the newest unsent buffer
// for a given path is retained; the currently in-flight write is not cancelled.
export class DebouncedSandboxQueue {
  private readonly pending = new Map<string, string>();
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private enabled = false;
  private halted = false;

  constructor(
    private readonly send: (file: string, content: string) => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly delayMs = 1_000,
  ) {
    if (!Number.isSafeInteger(delayMs) || delayMs < 100 || delayMs > 30_000) {
      throw new Error("Неверный интервал Codechuman auto-sync.");
    }
  }

  get isEnabled(): boolean { return this.enabled; }
  get isHalted(): boolean { return this.halted; }
  get pendingCount(): number { return this.pending.size; }

  enable(): void {
    this.enabled = true;
    this.halted = false;
    if (this.pending.size > 0) this.arm();
  }

  disable(): void {
    this.enabled = false;
    this.halted = false;
    this.pending.clear();
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  schedule(file: string, content: string): void {
    if (!this.enabled) return;
    this.pending.set(file, content);
    // A failed ACK or CAS conflict is a hard stop. Keep newer edits locally,
    // but never retry without an explicit new student decision.
    if (!this.halted) this.arm();
  }

  private arm(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain();
    }, this.delayMs);
  }

  private async drain(): Promise<void> {
    if (this.running || !this.enabled || this.halted || this.timer !== undefined) return;
    this.running = true;
    try {
      while (this.enabled && !this.halted && this.timer === undefined && this.pending.size > 0) {
        const first = this.pending.entries().next().value as [string, string];
        const [file, content] = first;
        this.pending.delete(file);
        try {
          await this.send(file, content);
        } catch (error) {
          // Preserve the edited buffer if no even-newer edit was scheduled.
          if (!this.pending.has(file)) this.pending.set(file, content);
          this.halted = true;
          this.onError(error);
          break;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
