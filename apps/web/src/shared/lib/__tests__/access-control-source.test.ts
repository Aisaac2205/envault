import { describe, expect, it } from "vitest";

// The API owns the permission map and the web app only asks it
// (`GET /me/permissions`). This keeps a second, hand-kept copy of the rules
// from creeping back in: a role compared to a string is exactly the drift that
// let a regular user open screens the API refuses (defect D8).
//
// `features/users` is the user-management screen, which edits and filters by
// role as data; it decides nothing about who may see what.

const sources = import.meta.glob<string>("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const checked = Object.entries(sources).filter(
  ([path]) =>
    !/\.test\.tsx?$/.test(path) &&
    !path.startsWith("/src/features/users/") &&
    !path.startsWith("/src/test/"),
);

const FORBIDDEN: [string, RegExp][] = [
  ["the removed `adminOnly` flag", /\badminOnly\b/],
  ["the removed `requiredRole` prop", /\brequiredRole\b/],
  ["a role compared to a literal", /\.role\s*[!=]==?\s*["'`]/],
  ["a literal compared to a role", /["'`]\s*[!=]==?\s*[\w.?]*\brole\b/],
];

describe("access control in the web app", () => {
  it("scans the sources it is meant to police", () => {
    const paths = checked.map(([path]) => path);

    expect(paths).toContain("/src/router.tsx");
    expect(paths).toContain("/src/shared/components/Sidebar.tsx");
    expect(paths).toContain("/src/shared/components/ProtectedRoute.tsx");
  });

  it.each(FORBIDDEN)("has no trace of %s", (_label, pattern) => {
    const offenders = checked
      .filter(([, source]) => pattern.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});
