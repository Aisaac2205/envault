import { PageHeader } from "@/shared/ui/page-header";
import { GlobalLoadingOverlay } from "@/shared/ui/TetrominoLoader";
import { useTranslation } from "react-i18next";
import { StoragePanel } from "./components/StoragePanel";
import { DbHygienePanel } from "./components/DbHygienePanel";
import { ReconcilePanel } from "./components/ReconcilePanel";
import { useStorageOverview } from "./hooks/useMaintenance";

export default function CleanupPage() {
  const { t } = useTranslation("cleanup");
  const { isLoading } = useStorageOverview();

  return (
    <>
      <div className="space-y-8 p-4 sm:p-6 lg:p-8">
        <PageHeader
          title={t("page.title")}
          subtitle={t("page.subtitle")}
        />

        {/* ── Storage Overview & Unified Retention Management ── */}
        <section>
          <StoragePanel />
        </section>

        {/* ── System Maintenance & Health ── */}
        <section className="space-y-4 pt-2">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {t("section.health.title")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t("section.health.description")}
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <DbHygienePanel />
            <ReconcilePanel />
          </div>
        </section>
      </div>

      <GlobalLoadingOverlay
        open={isLoading}
        label={t("loading", { defaultValue: "Cargando limpieza..." })}
      />
    </>
  );
}
