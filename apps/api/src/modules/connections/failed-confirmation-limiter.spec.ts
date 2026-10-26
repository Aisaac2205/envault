/// <reference types="jest" />
import { FailedConfirmationLimiter } from './failed-confirmation-limiter';

describe('FailedConfirmationLimiter', () => {
  let now: number;
  const limiter = (overrides: { maxFailures?: number; maxKeys?: number } = {}) =>
    new FailedConfirmationLimiter({
      maxFailures: 2,
      windowMs: 60_000,
      maxKeys: 100,
      now: () => now,
      ...overrides,
    });
  const wrong = async (): Promise<boolean> => false;
  const right = async (): Promise<boolean> => true;

  beforeEach(() => {
    now = 1_000_000;
  });

  // A check whose answer the test gives later.
  function heldCheck() {
    let answer = (_confirmed: boolean): void => undefined;
    const check = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    return { check, answer: (confirmed: boolean) => answer(confirmed) };
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it('records only wrong passwords, and locks the key once the budget is spent', async () => {
    const store = limiter();

    await expect(store.attempt('user-1', right)).resolves.toEqual({ outcome: 'confirmed' });
    await expect(store.attempt('user-1', wrong)).resolves.toEqual({ outcome: 'refused' });
    await expect(store.attempt('user-1', right)).resolves.toEqual({ outcome: 'confirmed' });
    await expect(store.attempt('user-1', wrong)).resolves.toEqual({ outcome: 'refused' });

    const check = jest.fn(right);
    await expect(store.attempt('user-1', check)).resolves.toEqual({
      outcome: 'locked',
      retryAfterSeconds: 60,
    });
    expect(check).not.toHaveBeenCalled();
    await expect(store.attempt('user-2', wrong)).resolves.toEqual({ outcome: 'refused' });
  });

  it('unlocks the key when the window that started with its first failure ends', async () => {
    const store = limiter();
    await store.attempt('user-1', wrong);
    now += 30_000;
    await store.attempt('user-1', wrong);

    now += 29_000;
    await expect(store.attempt('user-1', right)).resolves.toEqual({
      outcome: 'locked',
      retryAfterSeconds: 1,
    });

    now += 1_000;
    await expect(store.attempt('user-1', right)).resolves.toEqual({ outcome: 'confirmed' });
    expect(store.size.failures).toBe(0);
  });

  it("runs one key's checks one at a time, each after the previous one answered", async () => {
    const store = limiter();
    const first = heldCheck();
    const second = heldCheck();

    const firstAttempt = store.attempt('user-1', first.check);
    const secondAttempt = store.attempt('user-1', second.check);
    await flush();
    expect(first.check).toHaveBeenCalledTimes(1);
    expect(second.check).not.toHaveBeenCalled();

    first.answer(true);
    await expect(firstAttempt).resolves.toEqual({ outcome: 'confirmed' });
    await flush();
    expect(second.check).toHaveBeenCalledTimes(1);

    second.answer(false);
    await expect(secondAttempt).resolves.toEqual({ outcome: 'refused' });
  });

  it('does not make a key wait for the checks of another key', async () => {
    const store = limiter();
    const held = heldCheck();

    const slow = store.attempt('user-1', held.check);
    await expect(store.attempt('user-2', right)).resolves.toEqual({ outcome: 'confirmed' });

    held.answer(true);
    await expect(slow).resolves.toEqual({ outcome: 'confirmed' });
  });

  it('records nothing for a check that throws, and runs the next check', async () => {
    const store = limiter({ maxFailures: 1 });
    const fault = new Error('connect ECONNREFUSED');

    const failing = store.attempt('user-1', async () => {
      throw fault;
    });
    const next = store.attempt('user-1', right);

    await expect(failing).rejects.toBe(fault);
    await expect(next).resolves.toEqual({ outcome: 'confirmed' });
    expect(store.size.failures).toBe(0);
  });

  it('forgets the queue of a key once its checks have settled', async () => {
    const store = limiter();

    await Promise.all([store.attempt('user-1', right), store.attempt('user-1', wrong)]);
    await flush();

    expect(store.size.queues).toBe(0);
  });

  it('refuses users without failures once the key cap is reached, until a window ends', async () => {
    const store = limiter({ maxKeys: 2 });
    await store.attempt('user-1', wrong);
    now += 10_000;
    await store.attempt('user-2', wrong);

    const check = jest.fn(right);
    await expect(store.attempt('user-3', check)).resolves.toEqual({
      outcome: 'locked',
      retryAfterSeconds: 50,
    });
    expect(check).not.toHaveBeenCalled();
    // A user already counted keeps its own budget.
    await expect(store.attempt('user-1', right)).resolves.toEqual({ outcome: 'confirmed' });

    now += 50_000;
    await expect(store.attempt('user-3', check)).resolves.toEqual({ outcome: 'confirmed' });
    expect(store.size.failures).toBe(1);
  });
});
