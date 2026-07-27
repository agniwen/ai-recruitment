"use client";

import { ComposerPrimitive, INTERNAL, useComposer, useComposerRuntime } from "@assistant-ui/react";
import { LexicalComposerInput } from "@assistant-ui/react-lexical";
import { IconArrowUp } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { composerSendButtonClass } from "./recruiting-copilot-context";
import { RecruitingComposerDirectiveChip } from "./recruiting-directive-text";
import { RecruitingPersonMentionPopover } from "./recruiting-person-mention";

const newComposerInputClassName = cn(
  // Keep empty-state height close to the old textarea (min-h-9 + shell py-2).
  // Avoid stacking min-height on both the Lexical wrapper and contenteditable.
  "aui-composer-input relative max-h-36 min-w-0 flex-1 bg-transparent px-2 text-base text-foreground",
  "[&_.aui-lexical-input]:min-h-9 [&_.aui-lexical-input]:py-2 [&_.aui-lexical-input]:leading-6 [&_.aui-lexical-input]:outline-none [&_.aui-lexical-input]:whitespace-pre-wrap [&_p]:m-0",
  "[&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute [&_.aui-lexical-placeholder]:inset-x-2 [&_.aui-lexical-placeholder]:top-2 [&_.aui-lexical-placeholder]:text-muted-foreground",
);

function NewThreadEnterSubmitPlugin({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: () => void;
}) {
  "use no memo";
  // Prefer assistant-ui's input plugin registry over Lexical commands so we
  // don't import `@lexical/*` (Vite deep-import resolution is fragile here).
  // Lower priority than TriggerPopover (default 0) so @-mention Enter selects first.
  const pluginRegistry = INTERNAL.useComposerInputPluginRegistryOptional();
  const disabledRef = useRef(disabled);
  const onSubmitRef = useRef(onSubmit);

  useEffect(() => {
    disabledRef.current = disabled;
    onSubmitRef.current = onSubmit;
  }, [disabled, onSubmit]);

  useEffect(() => {
    if (!pluginRegistry) {
      return;
    }
    return pluginRegistry.register(
      {
        handleKeyDown(event) {
          if (event.key !== "Enter" || event.shiftKey) {
            return false;
          }
          if (event.ctrlKey || event.metaKey) {
            return false;
          }
          if (event.nativeEvent?.isComposing) {
            return false;
          }
          if (disabledRef.current) {
            return false;
          }
          event.preventDefault();
          onSubmitRef.current();
          return true;
        },
        // oxlint-disable-next-line no-empty-function -- required composer input adapter no-op.
        setCursorPosition() {},
      },
      { priority: -1 },
    );
  }, [pluginRegistry]);

  return null;
}

function NewRecruitingComposerShell({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => Promise<void>;
}) {
  "use no memo";
  const composerRuntime = useComposerRuntime();
  const text = useComposer((composer) => composer.text);
  const canSubmit = text.trim().length > 0 && !disabled;
  const submittingRef = useRef(false);

  const handleSubmit = async () => {
    if (submittingRef.current || disabled) {
      return;
    }
    const nextText = composerRuntime.getState().text.trim();
    if (!nextText) {
      return;
    }
    submittingRef.current = true;
    composerRuntime.setText("");
    try {
      await onSubmit(nextText);
    } finally {
      submittingRef.current = false;
    }
  };

  const submit = () => {
    void handleSubmit();
  };

  return (
    <div
      className={cn(
        "aui-composer-shell flex w-full items-end gap-2 rounded-[28px] border border-input bg-background px-3 py-2 transition-colors focus-within:border-foreground/20",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <LexicalComposerInput
        aria-label="招聘问题输入"
        autoFocus={!disabled}
        className={newComposerInputClassName}
        directiveChip={RecruitingComposerDirectiveChip}
        placeholder="输入招聘问题，或输入 @ 提及候选人..."
        submitMode="none"
      />
      <NewThreadEnterSubmitPlugin disabled={!canSubmit} onSubmit={submit} />
      <Button
        aria-label="发送"
        className={cn(composerSendButtonClass, "shrink-0")}
        disabled={!canSubmit}
        onClick={submit}
        size="icon"
        title="发送"
        type="button"
      >
        <IconArrowUp className="size-4" />
      </Button>
    </div>
  );
}

export function NewRecruitingComposer({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => Promise<void>;
}) {
  "use no memo";
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <NewRecruitingComposerShell disabled={disabled} onSubmit={onSubmit} />
        <RecruitingPersonMentionPopover />
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}
