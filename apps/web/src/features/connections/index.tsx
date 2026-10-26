import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  useConnections,
  useCreateConnection,
  useUpdateConnection,
  useDeleteConnection,
  useTestConnection,
  useTestRawConnection,
} from "./hooks/useConnections";
import ConnectionsTable from "./components/ConnectionsTable";
import ConnectionForm from "./components/ConnectionForm";
import { ConfirmProdDeleteDialog } from "./components/ConfirmProdDeleteDialog";
import { ConnectionsStats } from "./components/ConnectionsStats";
import {
  ConnectionFilters,
  useConnectionFilters,
} from "./components/ConnectionFilters";

import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { EmptyState } from "@/shared/ui/empty-state";
import { GlobalLoadingOverlay } from "@/shared/ui/TetrominoLoader";
import { apiErrorMessage } from "@/shared/lib/api-error";
import { Database } from "lucide-react";
import {
  isProdConnection,
  type Connection,
  type CreateConnectionDto,
  type UpdateConnectionDto,
  type ConnectionTestResult,
  type ProdDeleteConfirmation,
  type TestRawConnectionDto,
} from "./types";

export default function Connections() {
  const { t } = useTranslation('connections')
  const {
    data: connections = [],
    isLoading: isQueryLoading,
    error: queryError,
  } = useConnections();

  const createMutation = useCreateConnection();
  const updateMutation = useUpdateConnection();
  const deleteMutation = useDeleteConnection();
  const testMutation = useTestConnection();
  const testRawMutation = useTestRawConnection();

  const [showForm, setShowForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | undefined>(undefined);
  const [formLoading, setFormLoading] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({});
  const [testLoading, setTestLoading] = useState<Record<string, boolean>>({});
  // A PROD connection is deleted through the step-up dialog, not `window.confirm`.
  const [prodDeleteTarget, setProdDeleteTarget] = useState<Connection | null>(null);
  const [prodDeleteError, setProdDeleteError] = useState<string | null>(null);
  const [prodDeleting, setProdDeleting] = useState(false);

  const { filters, setFilters, filtered } = useConnectionFilters(connections);

  const handleNewClick = () => {
    setEditingConnection(undefined);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingConnection(undefined);
  };

  const handleSubmit = useCallback(
    async (dto: CreateConnectionDto | UpdateConnectionDto) => {
      setFormLoading(true);
      try {
        if (editingConnection) {
          await updateMutation.mutateAsync({
            id: editingConnection.id,
            dto: dto as UpdateConnectionDto,
          });
          toast.success(t('toast.updated'));
        } else {
          await createMutation.mutateAsync(dto as CreateConnectionDto);
          toast.success(t('toast.created'));
        }
        setShowForm(false);
        setEditingConnection(undefined);
      } catch {
        // Error surfaced via mutation state
      } finally {
        setFormLoading(false);
      }
    },
    [editingConnection, createMutation, updateMutation, t],
  );

  const handleEdit = useCallback((connection: Connection) => {
    setEditingConnection(connection);
    setShowForm(true);
  }, []);

  const handleDeleted = useCallback(
    (id: string) => {
      toast.success(t('toast.deleted'));
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setTestLoading((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [t],
  );

  const handleDelete = useCallback(
    async (connection: Connection) => {
      if (isProdConnection(connection)) {
        setProdDeleteError(null);
        setProdDeleteTarget(connection);
        return;
      }

      const confirmed = window.confirm(t('confirm.delete'));
      if (!confirmed) return;

      try {
        await deleteMutation.mutateAsync({ id: connection.id });
        handleDeleted(connection.id);
      } catch {
        // Error surfaced via mutation state
      }
    },
    [deleteMutation, handleDeleted, t],
  );

  const handleProdDeleteOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      setProdDeleteTarget(null);
      setProdDeleteError(null);
      // The refusal was shown in the dialog; it must not resurface on the page.
      deleteMutation.reset();
    },
    [deleteMutation],
  );

  const handleConfirmProdDelete = useCallback(
    async (confirmation: ProdDeleteConfirmation) => {
      if (!prodDeleteTarget) return;
      const { id } = prodDeleteTarget;
      setProdDeleting(true);
      setProdDeleteError(null);
      try {
        await deleteMutation.mutateAsync({ id, confirmation });
        handleDeleted(id);
        setProdDeleteTarget(null);
      } catch (error) {
        // Wrong name or password (403), too many failed passwords (429) or an
        // expired session (401): the dialog stays open and says why.
        setProdDeleteError(
          apiErrorMessage(error, t('error.unexpected', { ns: 'common' })),
        );
      } finally {
        setProdDeleting(false);
      }
    },
    [prodDeleteTarget, deleteMutation, handleDeleted, t],
  );

  const handleTest = useCallback(
    async (id: string) => {
      setTestLoading((prev) => ({ ...prev, [id]: true }));
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });

      try {
        const result = await testMutation.mutateAsync(id);
        setTestResults((prev) => ({ ...prev, [id]: result }));
        if (result.success) {
          toast.success(t('toast.testSuccess'), {
            description: t('toast.testSuccess.latency', { latency: result.latencyMs }),
          });
        } else {
          toast.error(t('toast.testFailed'), {
            description: result.error ?? t('error.generic', { ns: 'common' }),
          });
        }
      } catch {
        setTestResults((prev) => ({
          ...prev,
          [id]: {
            success: false,
            latencyMs: 0,
            error: t('toast.testError'),
          },
        }));
        toast.error(t('toast.testError'));
      } finally {
        setTestLoading((prev) => ({ ...prev, [id]: false }));
      }
    },
    [testMutation, t],
  );

  const testRaw = useCallback(
    async (dto: TestRawConnectionDto): Promise<ConnectionTestResult> => {
      return testRawMutation.mutateAsync(dto);
    },
    [testRawMutation],
  );

  // ─── Error state ────────────────────────────────────────

  if (queryError) {
    return (
      <div className="space-y-8 p-4 sm:p-6 lg:p-8">
        <PageHeader title={t('page.title')} />
        <Alert variant="destructive">
          <AlertDescription>
            {t('error.load', { message: queryError instanceof Error ? queryError.message : t('error.generic', { ns: 'common' }) })}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // ─── Empty state ────────────────────────────────────────

  if (!isQueryLoading && connections.length === 0 && !showForm) {
    return (
      <div className="space-y-8 p-4 sm:p-6 lg:p-8">
        <PageHeader title={t('page.title')} />
        <EmptyState
          icon={<Database className="h-12 w-12" />}
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            <Button onClick={handleNewClick}>{t('action.new')}</Button>
          }
        />
      </div>
    );
  }

  // ─── Normal state ───────────────────────────────────────

  // While the PROD delete dialog is open it shows its own refusal.
  const mutationError =
    createMutation.error ??
    updateMutation.error ??
    (prodDeleteTarget ? null : deleteMutation.error);

  return (
    <>
    <div className="space-y-8 p-4 sm:p-6 lg:p-8">
        <PageHeader
          title={t('page.title')}
          actions={
            !showForm ? (
              <Button onClick={handleNewClick}>{t('action.new')}</Button>
            ) : undefined
          }
        />

        {mutationError && (
          <Alert variant="destructive">
            <AlertDescription>
              {apiErrorMessage(mutationError, t('error.unexpected', { ns: 'common' }))}
            </AlertDescription>
          </Alert>
        )}

        <ConnectionsStats
          connections={connections}
          loading={isQueryLoading}
        />

        {showForm && (
          <ConnectionForm
            connection={editingConnection}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            isLoading={formLoading}
            testRaw={testRaw}
          />
        )}

        {connections.length > 0 && (
          <ConnectionFilters filters={filters} onChange={setFilters} />
        )}

        <ConnectionsTable
          connections={filtered}
          isLoading={isQueryLoading}
          onEdit={handleEdit}
          onDelete={(connection) => void handleDelete(connection)}
          onTest={(id) => void handleTest(id)}
          testResults={testResults}
          testLoading={testLoading}
        />
      </div>

      <ConfirmProdDeleteDialog
        open={prodDeleteTarget !== null}
        onOpenChange={handleProdDeleteOpenChange}
        connectionName={prodDeleteTarget?.name ?? ""}
        isLoading={prodDeleting}
        error={prodDeleteError}
        onConfirm={(confirmation) => void handleConfirmProdDelete(confirmation)}
      />

      <GlobalLoadingOverlay open={isQueryLoading} label={t('loading', { defaultValue: 'Cargando conexiones...' })} />
    </>
  );
}
