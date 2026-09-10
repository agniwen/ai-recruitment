import Markdown from "react-markdown";
import { cn } from "@arc/shared/utils";

const ALLOWED_ELEMENTS = ["p", "strong", "em", "ul", "ol", "li"];
const INLINE_UNORDERED_LIST_MARKER_RE = /([。！？；])[ \t]*-[ \t]+/g;
const INLINE_ORDERED_LIST_MARKER_RE = /([。！？；])[ \t]*(\d{1,2}[.)])[ \t]+/g;

export function RestrictedMarkdownView({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const normalized = content
    .replace(INLINE_UNORDERED_LIST_MARKER_RE, "$1\n- ")
    .replace(INLINE_ORDERED_LIST_MARKER_RE, "$1\n$2 ");
  return (
    <div className={cn("typeset typeset-compact min-w-0 max-w-full text-foreground", className)}>
      <Markdown allowedElements={ALLOWED_ELEMENTS} skipHtml unwrapDisallowed>
        {normalized}
      </Markdown>
    </div>
  );
}
