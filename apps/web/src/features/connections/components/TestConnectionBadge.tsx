import type { ReactNode } from "react";
import type { ConnectionTestResult } from "../types";
import { Badge, BadgeDot } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import { useTranslation } from "react-i18next";

interface TestConnectionBadgeProps {
  result: ConnectionTestResult | null;
  isLoading: boolean;
  /**
   * Fits the badge to a fixed column: a long error ends in an ellipsis and
   * reads whole on hover, instead of widening the table.
   */
  truncate?: boolean;
}

export default function TestConnectionBadge({
  result,
  isLoading,
  truncate = false,
}: TestConnectionBadgeProps) {
  const { t } = useTranslation("connections");

  const badge = (dot: ReactNode, text: string, content: ReactNode = text) => (
    <Badge variant="outline" className={cn("text-text-secondary", truncate && "min-w-0 max-w-full")} title={truncate ? text : undefined}>
      {dot}
      {truncate ? <span className="min-w-0 truncate">{content}</span> : content}
    </Badge>
  );

  if (isLoading) {
    return badge(<BadgeDot tone="info" pulse />, t("test.testing"));
  }

  if (!result) {
    return null;
  }

  if (result.success) {
    return badge(
      <BadgeDot tone="success" />,
      `${t("test.connected")} · ${result.latencyMs}ms`,
      <>
        {t("test.connected")} · <span className="font-mono">{result.latencyMs}ms</span>
      </>,
    );
  }

  return badge(<BadgeDot tone="error" />, t("test.error", { message: result.error ?? t("error.generic") }));
}
