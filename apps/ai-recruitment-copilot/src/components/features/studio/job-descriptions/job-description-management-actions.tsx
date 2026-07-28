"use client";

import { IconPlus, IconSparkles } from "@tabler/icons-react";
import type { JobDescriptionGoogleSheetsSyncResult } from "@arc/shared/job-descriptions";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { GoogleSheetsSyncButton } from "./google-sheets-sync-button";

export function JobDescriptionToolbarActions({
  canCreate,
  canSync,
  missingDepartment,
  onAiCreate,
  onCreate,
  onSynced,
}: {
  canCreate: boolean;
  canSync: boolean;
  missingDepartment: boolean;
  onAiCreate: () => void;
  onCreate: () => void;
  onSynced: (result: JobDescriptionGoogleSheetsSyncResult) => Promise<void> | void;
}) {
  if (!(canCreate || canSync)) {
    return null;
  }

  return (
    <div className="flex flex-1 flex-wrap justify-end gap-2 sm:flex-none">
      {canSync ? <GoogleSheetsSyncButton onSynced={onSynced} /> : null}
      {canCreate ? (
        <ButtonGroup className="flex-1 sm:flex-none">
          <Button className="flex-1 sm:flex-none" disabled={missingDepartment} onClick={onCreate}>
            <IconPlus className="size-4" />
            新建在招岗位
          </Button>
          <Button
            aria-label="AI 创建在招岗位"
            disabled={missingDepartment}
            onClick={onAiCreate}
            size="icon"
            title="AI 创建在招岗位"
            type="button"
          >
            <IconSparkles className="size-4" />
          </Button>
        </ButtonGroup>
      ) : null}
    </div>
  );
}
