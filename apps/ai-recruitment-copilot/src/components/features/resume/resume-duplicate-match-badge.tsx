"use client";

import type { ResumeDuplicateMatchSummary } from "@arc/shared/resume-duplicates";
import { cn } from "@arc/shared/utils";
import { Badge } from "@/components/ui/badge";
import { resumeBadgeShapeClass } from "./resume-badge-styles";

export function ResumeDuplicateMatchBadge({
  className,
  match,
  onClick,
}: {
  match: ResumeDuplicateMatchSummary;
  className?: string;
  onClick?: () => void;
}) {
  const isDuplicate = match.highestLevel === "high";
  const badgeText = isDuplicate ? "重复简历" : "相似简历";
  const label = match.count > 1 ? `${badgeText} ${match.count} 条` : badgeText;
  const variant = isDuplicate ? "destructive" : "secondary";

  if (!onClick) {
    return (
      <Badge className={cn("shrink-0", resumeBadgeShapeClass, className)} variant={variant}>
        {label}
      </Badge>
    );
  }

  return (
    <Badge
      className={cn("shrink-0 cursor-pointer", resumeBadgeShapeClass, className)}
      render={
        <button
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClick();
          }}
          type="button"
        >
          {label}
        </button>
      }
      variant={variant}
    />
  );
}
