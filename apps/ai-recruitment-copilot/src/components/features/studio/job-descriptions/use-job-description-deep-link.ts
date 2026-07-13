"use client";

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import type { JobDescriptionListRecord } from "@arc/shared/job-descriptions";

export function useJobDescriptionDeepLink(
  openEdit: (record: JobDescriptionListRecord) => Promise<void>,
) {
  const search = useSearch({ from: "/w/$slug/studio/job-descriptions" });
  const navigate = useNavigate({ from: "/w/$slug/studio/job-descriptions" });
  const openedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const targetId = search.jobDescriptionId;
    if (typeof targetId !== "string" || targetId.length === 0) {
      openedIdRef.current = null;
      return;
    }
    if (openedIdRef.current === targetId) {
      return;
    }
    openedIdRef.current = targetId;
    void openEdit({ id: targetId } as JobDescriptionListRecord);
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, jobDescriptionId: undefined }),
    });
  }, [navigate, openEdit, search.jobDescriptionId]);
}
