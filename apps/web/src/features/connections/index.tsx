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
import { Database } from "lucide-react";
import type {
  Connection,
  CreateConnectionDto,
  UpdateConnectionDto,
  ConnectionTestResult,
  TestRawConnectionDto,
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

  const handleDelete = useCallback(
    async (id: string) => {
      const confirmed = window.confirm(t('confirm.delete'));
      if (!confirmed) return;

      try {
        await deleteMutation.mutateAsync(id);
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
      } catch {
        // Error surfaced via mutation state
      }
    },
    [deleteMutation, t],
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

  const mutationError =
    createMutation.error ?? updateMutation.error ?? deleteMutation.error;

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
              {mutationError instanceof Error
                ? mutationError.message
                : t('error.unexpected', { ns: 'common' })}
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
          onDelete={(id) => void handleDelete(id)}
          onTest={(id) => void handleTest(id)}
          testResults={testResults}
          testLoading={testLoading}
        />
      </div>

      <GlobalLoadingOverlay open={isQueryLoading} label={t('loading', { defaultValue: 'Cargando conexiones...' })} />
    </>
  );
}
