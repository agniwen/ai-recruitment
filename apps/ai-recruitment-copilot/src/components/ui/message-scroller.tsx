"use client";

import { IconArrowDown } from "@tabler/icons-react";
import * as React from "react";
import { cn } from "@arc/shared/utils";
import { Button } from "@/components/ui/button";

interface MessageScrollerContextValue {
  autoScroll: boolean;
  viewportRef: React.RefObject<HTMLDivElement | null>;
}

const MessageScrollerContext = React.createContext<MessageScrollerContextValue | null>(null);

function useMessageScrollerContext() {
  return React.useContext(MessageScrollerContext);
}

function MessageScrollerProvider({
  autoScroll = false,
  children,
}: {
  autoScroll?: boolean;
  children: React.ReactNode;
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const value = React.useMemo(() => ({ autoScroll, viewportRef }), [autoScroll]);
  return (
    <MessageScrollerContext.Provider value={value}>{children}</MessageScrollerContext.Provider>
  );
}

function MessageScroller({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
        className,
      )}
      data-slot="message-scroller"
      {...props}
    />
  );
}

function MessageScrollerViewport({ className, ...props }: React.ComponentProps<"div">) {
  const context = useMessageScrollerContext();

  React.useEffect(() => {
    const viewport = context?.viewportRef.current;
    if (!viewport || !context.autoScroll) {
      return;
    }
    const scrollToEnd = () => {
      viewport.scrollTop = viewport.scrollHeight;
    };
    scrollToEnd();
    const observer = new MutationObserver(scrollToEnd);
    observer.observe(viewport, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [context]);

  return (
    <div
      className={cn("size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain", className)}
      data-slot="message-scroller-viewport"
      ref={context?.viewportRef}
      {...props}
    />
  );
}

function MessageScrollerContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex h-max min-h-full flex-col", className)}
      data-slot="message-scroller-content"
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor: _scrollAnchor,
  ...props
}: React.ComponentProps<"div"> & { scrollAnchor?: boolean }) {
  return (
    <div
      className={cn("min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem]", className)}
      data-slot="message-scroller-item"
      {...props}
    />
  );
}

function MessageScrollerButton({
  className,
  children,
  direction = "end",
  size = "icon-sm",
  variant = "secondary",
  ...props
}: React.ComponentProps<typeof Button> & { direction?: "start" | "end" }) {
  const context = useMessageScrollerContext();

  return (
    <Button
      className={cn(
        "absolute inset-x-1/2 border-border bg-background text-foreground shadow-sm",
        direction === "end" ? "bottom-4" : "top-4 [&_svg]:rotate-180",
        className,
      )}
      data-direction={direction}
      data-slot="message-scroller-button"
      size={size}
      type="button"
      variant={variant}
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        const viewport = context?.viewportRef.current;
        if (!viewport) {
          return;
        }
        viewport.scrollTo({
          behavior: "smooth",
          top: direction === "end" ? viewport.scrollHeight : 0,
        });
      }}
    >
      {children ?? (
        <>
          <IconArrowDown className="size-4" />
          <span className="sr-only">{direction === "end" ? "滚动到底部" : "滚动到顶部"}</span>
        </>
      )}
    </Button>
  );
}

function useMessageScroller() {
  return useMessageScrollerContext();
}

function useMessageScrollerScrollable() {
  return true;
}

function useMessageScrollerVisibility() {
  return true;
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
};
