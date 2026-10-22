import { randomBytes, randomInt } from 'node:crypto';

/** Eight hex characters: enough to keep parallel tests and repeated runs apart. */
export function uniqueId(): string {
  return randomBytes(4).toString('hex');
}

/** `e2e-<label>-<id>`: a readable name that is already a valid slug. */
export function uniqueName(label: string): string {
  return `e2e-${label}-${uniqueId()}`;
}

export function uniqueEmail(label: string): string {
  return `${uniqueName(label)}@envault.local`;
}

const issuedClientIps = new Set<string>();

/**
 * A client IP that no other request of this process has used, for the
 * `X-Forwarded-For` header. Better Auth counts sign-ins per client IP (3 per
 * 10 s, D3), so a sign-in with an address of its own never touches the bucket
 * that `setup` uses. The address is random rather than sequential so that two
 * runs started within 10 s of each other do not share a bucket either.
 */
export function uniqueClientIp(): string {
  let ip: string;
  do {
    ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  } while (issuedClientIps.has(ip));
  issuedClientIps.add(ip);
  return ip;
}
