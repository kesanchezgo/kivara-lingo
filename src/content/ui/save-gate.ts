/**
 * A gate for "create this meaning" clicks that land while a save is in
 * flight: nothing is lost — tasks queue up and run serially the moment the
 * current save opens the gate again.
 */
export interface SaveGate {
  /** Queue a task; it runs only after the gate has been opened. */
  push(task: () => Promise<unknown>): void;
  /** Open the gate: queued tasks run serially, in order. */
  open(): void;
  /** How many tasks are waiting. */
  size(): number;
}

export function createSaveGate(): SaveGate {
  const queue: Array<() => Promise<unknown>> = [];
  let running = false;
  const drain = async (): Promise<void> => {
    if (running) return;
    const next = queue.shift();
    if (!next) return;
    running = true;
    try {
      await next();
    } finally {
      running = false;
      void drain();
    }
  };
  return {
    push(task) {
      queue.push(task);
    },
    open() {
      void drain();
    },
    size: () => queue.length,
  };
}
