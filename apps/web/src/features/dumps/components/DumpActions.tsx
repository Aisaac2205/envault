import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Ban, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { dumpsApi } from "../api/dumps-api";
import type { BackupJob } from "../types";

interface DumpActionsProps {
  job: BackupJob;
}

export function DumpActions({ job }: DumpActionsProps) {
  const { t } = useTranslation(["dumps", "common"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const isCancellable = job.status === "running" || job.status === "pending";

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await dumpsApi.cancelBackup(job.id);
      toast.success(t("dumps:toast.cancelled"));
      await queryClient.invalidateQueries({ queryKey: ["dumps"] });
      setConfirmCancelOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("dumps:toast.cancelError");
      toast.error(t("dumps:toast.cancelError"), { description: message });
    } finally {
      setCancelling(false);
    }
  };

  if (isCancellable) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirmCancelOpen(true)}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive text-xs h-7 px-2"
          aria-label={t("dumps:action.cancel")}
        >
          <Ban className="h-3 w-3 mr-1" aria-hidden="true" />
          {t("dumps:action.cancel")}
        </Button>

        <Dialog open={confirmCancelOpen} onOpenChange={setConfirmCancelOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("dumps:confirm.cancelJob.title")}</DialogTitle>
              <DialogDescription>
                {t("dumps:confirm.cancelJob.description")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmCancelOpen(false)}
                disabled={cancelling}
              >
                {t("dumps:confirm.cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleCancel()}
                disabled={cancelling}
              >
                {cancelling && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" aria-hidden="true" />
                )}
                {cancelling ? t("dumps:action.cancelling") : t("dumps:confirm.cancelJob.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (job.status !== "completed" || !job.fileKey) {
    return <span className="text-muted-foreground text-xs">-</span>;
  }

  const handleRestore = () => {
    navigate("/restore", {
      state: { sourceBackupId: job.id, dbType: job.dbType },
    });
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const { url } = await dumpsApi.getDownloadUrl(job.id);
      const a = document.createElement("a");
      a.href = url;
      a.download = job.fileKey!.split("/").pop() ?? "backup.dump";
      a.click();
      toast.success(t("common:toast.downloadStarted"));
    } catch {
      toast.error(t("common:toast.downloadError"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void handleDownload()}
        disabled={downloading}
        aria-label={t("common:aria.downloadDump")}
      >
        <Download className="h-3.5 w-3.5" />
        {downloading ? t("common:action.downloading") : null}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleRestore}
        aria-label={t("common:aria.restoreBackup")}
      >
        {t("common:action.restore")}
      </Button>
    </div>
  );
}
