/** Slots remain owned until the worker and its cleanup settle. */
export class ChildPool {
  active = 0;
  peak = 0;
  private waiting: (() => void)[] = [];
  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('INVALID_CHILD_LIMIT');
  }
  async run<T>(caller: 'main' | 'subagent' | 'vision', work: () => Promise<T>): Promise<T> {
    if (caller !== 'main') throw new Error('CHILD_DELEGATION_DENIED');
    if (this.active >= this.limit) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    this.peak = Math.max(this.peak, this.active);
    try { return await work(); }
    finally {
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    }
  }
}
