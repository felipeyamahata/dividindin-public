export const DEFAULT_MAX_CONCURRENT = 3;
export const DEFAULT_MAX_QUEUE_SIZE = 30;
export const DEFAULT_QUEUE_TIMEOUT_MS = 5000;

/**
 * Error thrown when a bounded concurrency gate rejects work due to full queue or wait timeout.
 */
export class ConcurrencyLimitError extends Error {
  constructor(message, code = 'QUEUE_FULL') {
    super(message);
    this.name = 'ConcurrencyLimitError';
    this.code = code;
    this.status = 503;
  }
}

/**
 * Limits simultaneous CPU-heavy async tasks (such as scrypt hashing) with a bounded FIFO queue.
 */
export function createConcurrencyGate({
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
  maxQueueSize = DEFAULT_MAX_QUEUE_SIZE,
  queueTimeoutMs = DEFAULT_QUEUE_TIMEOUT_MS,
} = {}) {
  let active = 0;
  const queue = [];

  function dispatchNext() {
    while (active < maxConcurrent && queue.length > 0) {
      const entry = queue.shift();
      if (entry.settled) continue;
      if (entry.timer) clearTimeout(entry.timer);
      entry.settled = true;
      execute(entry.task, entry.resolve, entry.reject);
    }
  }

  function execute(task, resolve, reject) {
    active += 1;
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        dispatchNext();
      });
  }

  function run(task) {
    if (typeof task !== 'function') {
      return Promise.reject(new TypeError('Task must be a function'));
    }

    if (active < maxConcurrent) {
      return new Promise((resolve, reject) => execute(task, resolve, reject));
    }

    if (queue.length >= maxQueueSize) {
      return Promise.reject(
        new ConcurrencyLimitError(
          'Muitos acessos simultâneos no momento. Tente novamente em instantes.',
          'QUEUE_FULL',
        ),
      );
    }

    return new Promise((resolve, reject) => {
      const entry = { task, resolve, reject, settled: false, timer: null };
      if (queueTimeoutMs > 0) {
        entry.timer = setTimeout(() => {
          if (entry.settled) return;
          entry.settled = true;
          const index = queue.indexOf(entry);
          if (index !== -1) queue.splice(index, 1);
          reject(
            new ConcurrencyLimitError(
              'Servidor ocupado no momento. Tente novamente em alguns segundos.',
              'QUEUE_TIMEOUT',
            ),
          );
        }, queueTimeoutMs);
        if (typeof entry.timer.unref === 'function') entry.timer.unref();
      }
      queue.push(entry);
    });
  }

  function stats() {
    return { active, queued: queue.length, maxConcurrent, maxQueueSize };
  }

  return { run, stats };
}
