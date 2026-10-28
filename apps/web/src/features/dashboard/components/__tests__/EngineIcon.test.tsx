import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EngineMark } from "../connections-health/EngineIcon";

describe("EngineMark", () => {
  it.each([
    ["postgres", "PostgreSQL"],
    ["postgresql", "PostgreSQL"],
    ["mysql", "MySQL"],
    ["MySQL", "MySQL"],
  ])("draws %s as an icon named %s, with the full name on hover", (dbType, name) => {
    render(<EngineMark dbType={dbType} />);

    const icon = screen.getByRole("img", { name });
    expect(icon.querySelector("title")?.textContent).toBe(name);
    expect(icon).toHaveClass("size-4", "text-text-secondary");
  });

  it.each(["postgres", "mysql"])("paints %s in one color, the text color, never a brand fill", (dbType) => {
    const { container } = render(<EngineMark dbType={dbType} />);

    const painted = Array.from(container.querySelectorAll("svg [fill], svg [stroke]")).filter(
      (element) => !element.closest("mask"),
    );
    expect(painted.length).toBeGreaterThan(0);
    for (const element of painted) {
      for (const attribute of ["fill", "stroke"]) {
        const value = element.getAttribute(attribute);
        if (value !== null) expect(value).toBe("currentColor");
      }
    }
  });

  it("keeps the text chip for an engine it has no icon for", () => {
    render(<EngineMark dbType="mariadb" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("MARIADB")).toHaveClass("rounded", "border");
  });

  it("gives every icon its own mask, so two rows never share one", () => {
    const { container } = render(
      <>
        <EngineMark dbType="postgres" />
        <EngineMark dbType="postgres" />
      </>,
    );

    const ids = Array.from(container.querySelectorAll("mask")).map((mask) => mask.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(container.querySelector(`[mask="url(#${id})"]`)).not.toBeNull();
    }
  });
});
