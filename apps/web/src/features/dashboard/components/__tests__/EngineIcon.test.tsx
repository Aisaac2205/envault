import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MySQL from "@/shared/assets/MySQL.svg";
import PostgresSQL from "@/shared/assets/PostgresSQL.svg";
import { EngineMark } from "../connections-health/EngineIcon";

describe("EngineMark", () => {
  it.each([
    ["postgres", "PostgreSQL", PostgresSQL],
    ["postgresql", "PostgreSQL", PostgresSQL],
    ["mysql", "MySQL", MySQL],
    ["MySQL", "MySQL", MySQL],
  ])("draws %s as the official %s logo, with the full name on hover", (dbType, name, logo) => {
    render(<EngineMark dbType={dbType} />);

    const icon = screen.getByRole("img", { name });
    expect(icon.tagName).toBe("IMG");
    expect(icon).toHaveAttribute("src", logo);
    expect(icon).toHaveAttribute("title", name);
  });

  it("draws the logo at icon size, so a name keeps its width on a phone", () => {
    render(<EngineMark dbType="postgres" />);

    expect(screen.getByRole("img", { name: "PostgreSQL" })).toHaveClass("size-4", "shrink-0");
  });

  it("keeps the text chip for an engine it has no logo for", () => {
    render(<EngineMark dbType="mariadb" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("MARIADB")).toHaveClass("rounded", "border");
  });
});
