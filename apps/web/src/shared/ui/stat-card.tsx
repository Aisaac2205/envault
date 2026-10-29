import { Card, CardContent, type CardProps } from "@/shared/ui/card";
import { Badge, BadgeDot } from "@/shared/ui/badge";
import { type ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  trend?: { value: number; positive: boolean };
  /**
   * Optional content rendered to the right of the value+trend group.
   * Useful for inline decorations like a Sparkline that should sit
   * horizontally next to the metric without changing card height.
   */
  aside?: ReactNode;
  statusColor?: string;
  loading?: boolean;
  compact?: boolean;
  /**
   * The value is free text of any length, such as a connection name. Below sm
   * it is clamped to two lines instead of wrapping freely. From sm every value
   * is cut to one line either way.
   */
  truncate?: boolean;
  variant?: CardProps["variant"];
}

/**
 * Below sm the card is half a phone wide (about 156px at 360px), so it mirrors
 * the dashboard KPI card: it fills its grid cell, the padding and the figure
 * shrink, the label takes the icon's room, and values wrap instead of being
 * cut. From sm the card is unchanged.
 */
export function StatCard({
  label,
  value,
  icon,
  trend,
  aside,
  statusColor,
  compact = false,
  truncate = false,
  variant,
}: StatCardProps) {
  return (
    <Card variant={variant} className="max-sm:h-full">
      <CardContent className="p-3 max-sm:flex max-sm:h-full max-sm:flex-col sm:p-6">
        <div className="flex items-center gap-2">
          {icon && <span className="hidden text-muted-foreground sm:inline">{icon}</span>}
          <p className="text-sm font-medium text-muted-foreground max-sm:min-w-0 max-sm:break-words">
            {label}
          </p>
        </div>
        {/* Pinned to the bottom on a phone, so a label that wraps never misaligns the figures of a row. */}
        <div className="flex items-center gap-2 max-sm:mt-auto max-sm:pt-3 sm:mt-3">
          {/* A plain join, not cn: tailwind-merge drops leading-none when a text-* size follows it. */}
          <p
            className={[
              "min-w-0 font-semibold leading-none tracking-tight tabular-nums text-text-primary max-sm:[overflow-wrap:anywhere] sm:truncate",
              compact ? "text-2xl" : "text-2xl sm:text-3xl",
              // The clamp hides overflow: a taller line keeps the second line's descenders inside it.
              truncate && "max-sm:line-clamp-2 max-sm:leading-tight",
            ]
              .filter(Boolean)
              .join(" ")}
            style={statusColor ? { color: statusColor } : undefined}
          >
            {value}
          </p>
          {trend && (
            <Badge variant="outline" className="shrink-0">
              <BadgeDot tone={trend.positive ? "success" : "error"} />
              {trend.positive ? "↑" : "↓"} {trend.value}%
            </Badge>
          )}
          {aside && <div className="ml-auto shrink-0">{aside}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
