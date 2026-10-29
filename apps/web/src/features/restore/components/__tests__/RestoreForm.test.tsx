import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RestoreForm } from "../RestoreForm";

function renderForm(backupInfo: React.ComponentProps<typeof RestoreForm>["backupInfo"]) {
  return render(
    <MemoryRouter>
      <RestoreForm
        sourceBackupId="job-1"
        dbType="postgres"
        backupInfo={backupInfo}
        onDryRun={vi.fn()}
        onRestore={vi.fn()}
        isLoading={false}
        connections={[]}
        connectionsLoading={false}
        sourceConnections={[]}
      />
    </MemoryRouter>,
  );
}

describe("RestoreForm selected backup", () => {
  it("names the connection the backup came from", () => {
    renderForm({ connectionName: "orders-db", environment: "prod" });

    expect(screen.getByText("orders-db")).toBeInTheDocument();
  });

  it("says the connection was deleted when the API returns no name for it", () => {
    renderForm({ connectionName: null, environment: "prod" });

    expect(screen.getByText("Conexión eliminada")).toBeInTheDocument();
    expect(screen.queryByText("Backup")).not.toBeInTheDocument();
  });

  it("keeps the generic label while the backup details are not loaded", () => {
    renderForm(undefined);

    expect(screen.getByText("Backup")).toBeInTheDocument();
  });
});
