import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { UsersStats } from "../components/UsersStats";
import type { User } from "../types";

const user: User = {
  id: "user-1",
  email: "admin@vaultly.local",
  name: "Admin",
  role: "admin",
  banned: null,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
  emailVerified: true,
};

describe("UsersStats", () => {
  it("lays the cards out two by two on a phone and in one row from lg, like the dashboard KPIs", () => {
    const { container } = render(
      <UsersStats users={[user, { ...user, id: "user-2", role: "user", banned: true }]} />,
    );

    const grid = container.firstElementChild as HTMLElement;
    expect(grid).toHaveClass("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", { exact: true });
    expect(grid.children).toHaveLength(4);
    for (const item of Array.from(grid.children)) {
      expect(item).toHaveClass("h-full");
    }
  });
});
