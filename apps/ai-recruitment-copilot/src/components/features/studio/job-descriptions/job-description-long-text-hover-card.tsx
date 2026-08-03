"use client";

import { useState } from "react";

import { cn } from "@arc/shared/utils";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";

export function JobDescriptionLongTextHoverCard({
  label,
  previewClassName,
  value,
}: {
  label: string;
  previewClassName?: string;
  value: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const text = value?.trim();

  if (!text) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }

  return (
    <HoverCard onOpenChange={setOpen} open={open}>
      <HoverCardTrigger
        delay={250}
        render={
          <button
            aria-label={`查看${label}完整内容`}
            className={cn(
              "block cursor-pointer truncate text-left underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none",
              previewClassName,
            )}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(true);
            }}
            type="button"
          >
            {text}
          </button>
        }
      />
      <HoverCardContent
        align="start"
        className="w-[30rem] max-w-[calc(100vw-2rem)]"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        sideOffset={8}
      >
        <div className="flex min-h-0 flex-col gap-2">
          <h4 className="whitespace-pre-line font-medium text-muted-foreground text-xs">{label}</h4>
          <ScrollArea className="max-h-72" scrollFade>
            <p className="pr-3 whitespace-pre-wrap wrap-break-word text-sm leading-6">{text}</p>
          </ScrollArea>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
