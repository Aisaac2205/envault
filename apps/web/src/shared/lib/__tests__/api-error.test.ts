import { describe, expect, it } from "vitest";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { apiErrorMessage } from "../api-error";

const FALLBACK = "Unexpected error";

/** An Axios error as the client rejects it when the API answers with `status`. */
function axiosErrorWith(status: number, data: unknown): AxiosError {
  const response = {
    status,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data,
  } as AxiosResponse;
  return new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_REQUEST,
    undefined,
    undefined,
    response,
  );
}

describe("apiErrorMessage", () => {
  it("returns the message the API put in its error body", () => {
    const error = axiosErrorWith(403, {
      error: {
        code: "ForbiddenException",
        message: "La confirmación de contraseña falló.",
        statusCode: 403,
      },
      timestamp: "2026-10-26T10:00:00Z",
      path: "/api/connections/conn-1",
    });

    expect(apiErrorMessage(error, FALLBACK)).toBe(
      "La confirmación de contraseña falló.",
    );
  });

  it("falls back when the response carries no error body", () => {
    expect(apiErrorMessage(axiosErrorWith(502, "<html>Bad gateway</html>"), FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("falls back when the error message is empty or not text", () => {
    expect(apiErrorMessage(axiosErrorWith(403, { error: { message: "" } }), FALLBACK)).toBe(
      FALLBACK,
    );
    expect(apiErrorMessage(axiosErrorWith(403, { error: { message: 42 } }), FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it("falls back when the request never got a response", () => {
    const error = new AxiosError("Network Error", AxiosError.ERR_NETWORK);

    expect(apiErrorMessage(error, FALLBACK)).toBe(FALLBACK);
  });

  it("falls back for anything that is not an Axios error", () => {
    expect(apiErrorMessage(new Error("boom"), FALLBACK)).toBe(FALLBACK);
    expect(apiErrorMessage(null, FALLBACK)).toBe(FALLBACK);
  });
});
