import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import MySQL from "@/shared/assets/MySQL.svg";
import PostgresSQL from "@/shared/assets/PostgresSQL.svg";
import { EngineLogo, EngineName } from "../EngineIcon";

describe("EngineLogo", () => {
  it.each([
    ["postgres", "PostgreSQL", PostgresSQL],
    ["postgresql", "PostgreSQL", PostgresSQL],
    ["mysql", "MySQL", MySQL],
    ["MySQL", "MySQL", MySQL],
  ])("draws %s as the official %s logo, named for it", (dbType, name, logo) => {
    render(<EngineLogo dbType={dbType} />);

    const icon = screen.getByRole("img", { name });
    expect(icon).toHaveAttribute("src", logo);
    expect(icon).toHaveAttribute("title", name);
    expect(icon).toHaveClass("size-5", "shrink-0");
  });

  it.each([["mariadb"], [null], [undefined]])("draws nothing for an engine without a logo (%s)", (dbType) => {
    const { container } = render(<EngineLogo dbType={dbType} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("EngineName", () => {
  it("leads the name with the logo of a known engine", () => {
    render(
      <EngineName dbType="postgres">
        <span>orders</span>
      </EngineName>,
    );

    const logo = screen.getByRole("img", { name: "PostgreSQL" });
    const name = screen.getByText("orders");
    expect(logo.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the name alone for an engine without a logo", () => {
    render(
      <EngineName dbType={null}>
        <span>legacy</span>
      </EngineName>,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("legacy")).toBeInTheDocument();
  });

  it("puts a fallback after the name when an engine has no logo", () => {
    render(
      <EngineName dbType="mariadb" fallback={<span>MARIADB</span>}>
        <span>legacy</span>
      </EngineName>,
    );

    const name = screen.getByText("legacy");
    const chip = screen.getByText("MARIADB");
    expect(name.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lets the caller style the logo's box", () => {
    render(
      <EngineName dbType="postgres" markClassName="hidden @max-2xl/table:flex">
        <span>orders</span>
      </EngineName>,
    );

    expect(screen.getByRole("img", { name: "PostgreSQL" }).parentElement).toHaveClass("hidden", "@max-2xl/table:flex");
  });

  it("shows no fallback beside a logo", () => {
    render(
      <EngineName dbType="mysql" fallback={<span>MYSQL</span>}>
        <span>billing</span>
      </EngineName>,
    );

    expect(screen.queryByText("MYSQL")).not.toBeInTheDocument();
  });
});
