import argon2 from 'argon2';

/**
 * Argon2id with OWASP's minimum recommended parameters (19 MiB, t=2, p=1).
 * Hashing deliberately costs tens of milliseconds of CPU, so auth endpoints have
 * their own (much lower) throughput targets and rate limits than CRUD endpoints.
 */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Run a real verification when the account does not exist, so "unknown email"
 * and "wrong password" take comparable time and cannot be told apart by timing.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalization-1');
  await verifyPassword(await dummyHash, password);
}
