import axios from "axios";

/**
 * The message the API put in its error body
 * (`{ error: { code, message, statusCode }, timestamp, path }`), or `fallback`
 * when the request failed without one (no response, a proxy page, or an error
 * that never came from the API). Axios's own message ("Request failed with
 * status code 403") is never shown: it tells the user nothing.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) return fallback;

  const body: unknown = error.response?.data;
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return fallback;
  }

  const details: unknown = body.error;
  if (typeof details !== "object" || details === null || !("message" in details)) {
    return fallback;
  }

  const { message } = details;
  return typeof message === "string" && message.length > 0 ? message : fallback;
}
