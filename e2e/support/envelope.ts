import { expect, type APIResponse } from '@playwright/test';

/** Error body the API's exception filter produces for every non-Better-Auth route. */
export interface ErrorEnvelope {
  error: { code: string; message: string; statusCode: number };
  timestamp: string;
  path: string;
}

/**
 * Asserts the `{ data, timestamp }` wrapper that the transform interceptor puts
 * around successful bodies, and returns `data`. Better Auth routes (`/auth/*`)
 * and `DELETE` (which has no body to wrap) are the documented exceptions.
 */
export async function expectSuccessEnvelope<T = unknown>(
  response: APIResponse,
  status = 200,
): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);

  const body = await response.json();
  expect(body).toEqual({ data: expect.anything(), timestamp: expect.any(String) });
  expectIsoTimestamp(body.timestamp);
  return body.data as T;
}

/**
 * Asserts the `{ error: { code, message, statusCode }, timestamp, path }` body
 * and the status. It deliberately does not pin `code` or `message`: the
 * messages are Spanish and may be reworded, the shape is the contract.
 */
export async function expectErrorEnvelope(
  response: APIResponse,
  statusCode: number,
): Promise<ErrorEnvelope> {
  expect(response.status(), await response.text()).toBe(statusCode);

  const body: ErrorEnvelope = await response.json();
  // toEqual rejects extra keys, so a leaked `stack` or `cause` fails here.
  expect(body).toEqual({
    error: { code: expect.any(String), message: expect.any(String), statusCode },
    timestamp: expect.any(String),
    path: expect.any(String),
  });
  expect(body.error.code).toMatch(/\S/);
  expect(body.error.message).toMatch(/\S/);
  expectIsoTimestamp(body.timestamp);

  const url = new URL(response.url());
  expect(body.path).toBe(url.pathname + url.search);
  return body;
}

function expectIsoTimestamp(value: string): void {
  expect(new Date(value).toISOString()).toBe(value);
}
