"use client";

import { useRef, useState } from "react";
import { IconFile, IconLink, IconPaperclip } from "@tabler/icons-react";
import type { PortfolioLinkInput } from "@arc/shared/bulk-resume-upload";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PortfolioLinkDialog } from "./portfolio-link-dialog";

export function PortfolioAddMenu({
  disabled = false,
  remaining,
  label = "添加作品集",
  onFiles,
  onLinks,
}: {
  disabled?: boolean;
  remaining: number;
  label?: string;
  onFiles: (files: File[]) => void;
  onLinks: (links: PortfolioLinkInput[]) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [addingLinks, setAddingLinks] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="sm" variant="link" disabled={disabled || remaining <= 0} />}
        >
          <IconPaperclip />
          {label}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => inputRef.current?.click()}>
              <IconFile />
              上传文件
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAddingLinks(true)}>
              <IconLink />
              添加链接
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={inputRef}
        aria-label="上传作品集附件"
        className="sr-only"
        tabIndex={-1}
        type="file"
        multiple
        disabled={disabled || remaining <= 0}
        accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.mp4,.mov,.zip"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])].slice(0, remaining);
          event.target.value = "";
          if (files.length) {
            onFiles(files);
          }
        }}
      />
      {addingLinks ? (
        <PortfolioLinkDialog
          maxLinks={remaining}
          onClose={() => setAddingLinks(false)}
          onSubmit={onLinks}
        />
      ) : null}
    </>
  );
}
