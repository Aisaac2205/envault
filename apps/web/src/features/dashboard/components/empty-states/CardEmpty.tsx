import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

interface CardEmptyProps {
  /**
   * A lucide icon; it shows in the muted color unless it brings its own (a status,
   * for instance). Left out only where the card draws its own picture beside it.
   */
  icon?: ReactNode;
  /** One short line: what will appear here, or why nothing does. */
  message: string;
  /** At most one action. */
  action?: ReactNode;
  /** The card's own height for its body (its loading height), so the frame never jumps. */
  className?: string;
}

/**
 * What a dashboard card shows in place of its data: a muted icon, one line and
 * at most one action, with the same padding in every card. The card passes the
 * height its body has while loading, so loading, empty and data keep one frame.
 */
export function CardEmpty({ icon, message, action, className }: CardEmptyProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-2 px-4 py-5 text-center", className)}
      data-testid="card-empty"
    >
      {icon && (
        <span aria-hidden="true" className="flex text-muted-foreground [&>svg]:size-6">
          {icon}
        </span>
      )}
      <p className="max-w-sm text-balance text-sm text-text-secondary">{message}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
