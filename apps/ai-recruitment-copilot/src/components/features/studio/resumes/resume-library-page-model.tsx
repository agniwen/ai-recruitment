import { normalizeListTextSearchParam } from "@arc/shared/list-text-filters";
import type { ReactVirtualizer, VirtualItem } from "@tanstack/react-virtual";
import { useElementScrollRestoration, useRouter } from "@tanstack/react-router";
import { parseDataGridSearchParams } from "@/components/data-grid/query-contract";
import {
  RESUME_LIBRARY_INFINITE_PAGE_SIZE,
  resumeLibrarySortIds,
} from "@arc/shared/studio-resumes";
import type { ResumeLibraryListRecord } from "@arc/shared/studio-resumes";
import { pipelineStageValues } from "@arc/db-schema/studio-interviews";

import {
  lazy,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";
import { STUDIO_MAIN_SCROLL_RESTORATION_ID } from "@/components/features/studio/studio-scroll-restoration";
import { copyTextToClipboard, toAbsoluteUrl } from "@/lib/client/clipboard";

export const ResumeDocumentPreviewDialog = lazy(async () => {
  const mod = await import("@/components/features/resume/resume-document-preview-dialog");
  return { default: mod.ResumeDocumentPreviewDialog };
});

export interface ResumeFilters extends Record<string, string> {
  activity: string;
  activityFrom: string;
  activityTo: string;
  candidateEmail: string;
  candidateName: string;
  textFilters: string;
  candidatePhone: string;
  creatorIds: string;
  hiringUnitId: string;
  id: string;
  jdIds: string;
  skills: string;
  stage: string;
}

// 工具栏多选下拉在 state/URL 里以 CSV 字符串编码，符合 data-grid 工具栏约定。
// 文本筛选项（ID / 姓名 / 邮箱 / 电话）各自独立，彼此 AND。
// 「hiringUnitId」= 用人组织（可搜索单选）。
// 「jdIds」= 关联岗位（可搜索单选，值为单个岗位 id）。
// 「skills」= 候选人必须同时拥有所有选中的技能（AND）。
// Multi-select toolbar filters are CSV-encoded per the data-grid convention.
// Text filters are independent string fields (AND).
// hiringUnitId / jdIds = searchable single-selects.
// skills = candidate must have ALL selected skills (intersection / AND).
export const EMPTY_FILTERS: ResumeFilters = {
  activity: "",
  activityFrom: "",
  activityTo: "",
  candidateEmail: "",
  candidateName: "",
  candidatePhone: "",
  creatorIds: "",
  hiringUnitId: "",
  id: "",
  jdIds: "",
  skills: "",
  stage: "",
  textFilters: "",
};
export const RESUME_LIBRARY_FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof ResumeFilters &
  string)[];
export const RESUME_LIBRARY_DEFAULT_SORTING = [{ desc: true, id: "createdAt" }];
const RESUME_LIBRARY_CARD_HEIGHTS = {
  base: 714,
  lg: 476,
  md: 534,
  sm: 596,
  xl: 290,
  xxl: 272,
} as const;

export function getResumeLibraryCardHeight(viewportWidth: number) {
  if (viewportWidth >= 1536) {
    return RESUME_LIBRARY_CARD_HEIGHTS.xxl;
  }
  if (viewportWidth >= 1280) {
    return RESUME_LIBRARY_CARD_HEIGHTS.xl;
  }
  if (viewportWidth >= 1024) {
    return RESUME_LIBRARY_CARD_HEIGHTS.lg;
  }
  if (viewportWidth >= 768) {
    return RESUME_LIBRARY_CARD_HEIGHTS.md;
  }
  if (viewportWidth >= 640) {
    return RESUME_LIBRARY_CARD_HEIGHTS.sm;
  }
  return RESUME_LIBRARY_CARD_HEIGHTS.base;
}

const RESUME_LIBRARY_CARD_MEDIA_QUERIES = [640, 768, 1024, 1280, 1536].map(
  (width) => `(min-width: ${width}px)`,
);

const subscribeToViewportWidth = (onStoreChange: () => void) => {
  const mediaQueries = RESUME_LIBRARY_CARD_MEDIA_QUERIES.map((query) => window.matchMedia(query));
  for (const mediaQuery of mediaQueries) {
    mediaQuery.addEventListener("change", onStoreChange);
  }
  return () => {
    for (const mediaQuery of mediaQueries) {
      mediaQuery.removeEventListener("change", onStoreChange);
    }
  };
};

const getViewportCardHeight = () => getResumeLibraryCardHeight(window.innerWidth);
const getServerCardHeight = () => RESUME_LIBRARY_CARD_HEIGHTS.lg;

export function useResumeLibraryCardHeight() {
  return useSyncExternalStore(subscribeToViewportWidth, getViewportCardHeight, getServerCardHeight);
}

export interface ResumeLibraryScrollRestoreSnapshot {
  measurements: VirtualItem[];
  recordId: string;
  recordTopInScrollElement: number;
  scrollOffset: number;
  viewportWidth: number;
}

export const resumeLibraryScrollRestoreSnapshot: {
  current: ResumeLibraryScrollRestoreSnapshot | null;
} = { current: null };

export function setResumeLibraryScrollRestoreSnapshot(
  snapshot: ResumeLibraryScrollRestoreSnapshot | null,
) {
  resumeLibraryScrollRestoreSnapshot.current = snapshot;
}

export function useResumeLibraryInitialScrollRestore(
  restoreSnapshot: ResumeLibraryScrollRestoreSnapshot | null,
) {
  const initialScrollElement =
    typeof document === "undefined"
      ? null
      : document.querySelector<HTMLElement>(
          `[data-scroll-restoration-id="${STUDIO_MAIN_SCROLL_RESTORATION_ID}"]`,
        );
  const canUseInitialMeasurements =
    !!restoreSnapshot &&
    !!initialScrollElement &&
    restoreSnapshot.viewportWidth === initialScrollElement.clientWidth;
  const studioScrollEntry = useElementScrollRestoration({
    id: STUDIO_MAIN_SCROLL_RESTORATION_ID,
  });

  return {
    initialMeasurementsCache: canUseInitialMeasurements ? restoreSnapshot.measurements : undefined,
    initialOffset: canUseInitialMeasurements
      ? restoreSnapshot.scrollOffset
      : studioScrollEntry?.scrollY,
  };
}

export function useResumeLibraryResizeScrollRestore({
  listRootRef,
  records,
  restoreSnapshotRef,
  scrollElement,
  virtualizer,
}: {
  listRootRef: RefObject<HTMLDivElement | null>;
  records: ResumeLibraryListRecord[];
  restoreSnapshotRef: RefObject<ResumeLibraryScrollRestoreSnapshot | null>;
  scrollElement: HTMLElement | null;
  virtualizer: ReactVirtualizer<HTMLElement, HTMLElement>;
}) {
  useEffect(() => {
    const snapshot = restoreSnapshotRef.current;
    if (!snapshot || !scrollElement || records.length === 0) {
      return;
    }
    const recordIndex = records.findIndex((record) => record.id === snapshot.recordId);
    if (recordIndex === -1) {
      resumeLibraryScrollRestoreSnapshot.current = null;
      restoreSnapshotRef.current = null;
      return;
    }
    if (scrollElement.clientWidth === snapshot.viewportWidth) {
      resumeLibraryScrollRestoreSnapshot.current = null;
      restoreSnapshotRef.current = null;
      return;
    }

    let cancelled = false;
    let frame: number | null = null;
    let remainingAttempts = 4;
    const clearSnapshot = () => {
      resumeLibraryScrollRestoreSnapshot.current = null;
      restoreSnapshotRef.current = null;
    };
    const alignToSnapshot = () => {
      if (cancelled) {
        return;
      }
      const rowElement = listRootRef.current?.querySelector<HTMLElement>(
        `[data-resume-record-id="${snapshot.recordId}"]`,
      );
      if (!rowElement && remainingAttempts > 0) {
        remainingAttempts -= 1;
        frame = window.requestAnimationFrame(alignToSnapshot);
        return;
      }
      if (rowElement) {
        const nextTop =
          rowElement.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top;
        const correction = nextTop - snapshot.recordTopInScrollElement;
        if (Math.abs(correction) > 1) {
          virtualizer.scrollToOffset(scrollElement.scrollTop + correction);
        }
      }
      clearSnapshot();
    };
    virtualizer.scrollToIndex(recordIndex, { align: "start" });
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(alignToSnapshot);
    });

    return () => {
      cancelled = true;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [listRootRef, records, restoreSnapshotRef, scrollElement, virtualizer]);
}

export interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export function firstSearchValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined;
}

// pipelineStage tab 副标题文案——简短，避免 tab 撑得过宽，移动端会隐藏。
// Short helper text shown inside each pipelineStage tab; hidden on mobile so
// tabs stay compact in narrow viewports.
export const PIPELINE_STAGE_TAB_DESCRIPTIONS: Record<string, string> = {
  ai_interview: "AI 面试阶段",
  all: "全部候选人",
  closed: "已结案候选人",
  human_interview: "等候真人复面",
  offer: "Offer 协商中",
  screening: "简历筛选中",
  written_test: "笔试阶段",
};

// 笔试阶段暂未启用对应的入口/元数据 UI，先在 tabs 中隐藏，避免点进去发现啥也没有。
// schema、后端 API 仍保留，把 UI 建出来后只要从这里删掉对应 key 即可。
// Stages without a working entry UI are hidden from the tabs to avoid empty
// drilldowns. Schema + backend support stays; remove from this set once the
// stage's UI is built.
export const HIDDEN_PIPELINE_STAGE_TABS = new Set<string>(["written_test"]);

export function buildResumeDetailShareText(fullLink: string, recommendationText: string | null) {
  const recommendation = recommendationText?.trim();
  return recommendation ? `${fullLink}\n\n${recommendation}` : fullLink;
}

/** Returns true when the clipboard write succeeded (caller may show a follow-up reminder). */
export async function copyResumeDetailLink(
  slug: string,
  record: ResumeLibraryListRecord,
): Promise<boolean> {
  const fullLink = toAbsoluteUrl(`/resume-review/${slug}/${record.id}`);
  const shareText = buildResumeDetailShareText(fullLink, record.recommendationText);
  try {
    const result = await copyTextToClipboard(shareText);
    if (result === "copied") {
      toast.success("详情链接已复制");
      return true;
    }
    if (result === "manual") {
      toast.info("已弹出链接，请手动复制");
      return false;
    }
    throw new Error("copy-failed");
  } catch {
    toast.error("复制失败，请手动复制");
    return false;
  }
}

export const VISIBLE_PIPELINE_STAGES = pipelineStageValues.filter(
  (s) => !HIDDEN_PIPELINE_STAGE_TABS.has(s),
);

export function findVerticalScrollParent(node: HTMLElement | null): HTMLElement | null {
  let parent = node?.parentElement ?? null;
  while (parent && parent !== document.body) {
    const style = getComputedStyle(parent);
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

export function useResumeLibraryScrollElement(listRootRef: RefObject<HTMLDivElement | null>) {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    const selectStudioViewport = () => {
      const viewport = document.querySelector<HTMLElement>(
        `[data-scroll-restoration-id="${STUDIO_MAIN_SCROLL_RESTORATION_ID}"]`,
      );
      if (!viewport) {
        return false;
      }
      setScrollElement(viewport);
      observer?.disconnect();
      return true;
    };

    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(selectStudioViewport);
      observer.observe(document.body, {
        attributeFilter: ["data-scroll-restoration-id"],
        attributes: true,
        subtree: true,
      });
    }

    const frame = window.requestAnimationFrame(() => {
      if (!selectStudioViewport()) {
        setScrollElement(findVerticalScrollParent(listRootRef.current));
      }
    });
    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [listRootRef]);

  return scrollElement;
}

export function formatResumeLibraryJobDescriptionLabel(record: ResumeLibraryListRecord) {
  return record.jobDescriptionName
    ? [record.jobDescriptionDepartmentName, record.jobDescriptionName].filter(Boolean).join(" / ")
    : null;
}

export interface FetchParams {
  signal: AbortSignal;
  knownTotal?: number;
  page: number;
  pageSize: number;
  filters: ResumeFilters;
  sortBy: string | undefined;
  sortOrder: "asc" | "desc" | undefined;
}

export type ResumeLibraryRowSelection = Record<string, boolean>;

export interface ResumeLibraryQueryState {
  filters: ResumeFilters;
  page: number;
  pageSize: number;
  search: string;
  sortBy: string | undefined;
  sortOrder: "asc" | "desc" | undefined;
}

export interface ResumeLibraryGridState {
  bind: {
    canResetFilters: boolean;
    filterValues: Record<string, string>;
    onFilterChange: (key: string, value: string) => void;
    onRefresh: () => void;
    onResetFilters: () => void;
    rowSelection: ResumeLibraryRowSelection;
  };
  deferredFilters: ResumeFilters;
  filters: ResumeFilters;
  rowSelection: ResumeLibraryRowSelection;
  setFilter: (key: keyof ResumeFilters & string, value: string) => void;
  setRowSelection: Dispatch<SetStateAction<ResumeLibraryRowSelection>>;
  sorting: { desc: boolean; id: string }[];
}

export type SearchParamsPrimitive = boolean | number | string;
export type SearchParamsRecord = Record<
  string,
  SearchParamsPrimitive | SearchParamsPrimitive[] | undefined
>;

export interface UseResumeLibrarySearchStateOptions {
  onRefresh: () => void;
  search: SearchParamsRecord;
  slug: string;
}

export function coerceSearchParams(search: Record<string, unknown>): SearchParamsRecord {
  const out: SearchParamsRecord = {};
  for (const [key, value] of Object.entries(search)) {
    if (key === "textFilters") {
      out[key] = normalizeListTextSearchParam(value);
      continue;
    }
    if (typeof value === "string") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.filter(
        (item): item is boolean | number | string =>
          typeof item === "string" || typeof item === "number" || typeof item === "boolean",
      );
    }
  }
  return out;
}

export function parseResumeQuery(searchParams: SearchParamsRecord): ResumeLibraryQueryState {
  return parseDataGridSearchParams(
    { ...searchParams, search: undefined },
    {
      allowedSortIds: resumeLibrarySortIds,
      defaultPageSize: RESUME_LIBRARY_INFINITE_PAGE_SIZE,
      defaultSorting: RESUME_LIBRARY_DEFAULT_SORTING,
      initialFilters: EMPTY_FILTERS,
    },
  );
}

export function useResumeLibrarySearchState({
  onRefresh,
  search: routeSearch,
  slug,
}: UseResumeLibrarySearchStateOptions): ResumeLibraryGridState {
  const router = useRouter();
  const query = useMemo(() => parseResumeQuery(routeSearch), [routeSearch]);
  // DebouncedSearchInput already debounces commits; deferredFilters still
  // keeps the list query behind concurrent rendering of rapid filter edits.
  const deferredFilters = useDeferredValue(query.filters);
  const [rowSelection, setRowSelection] = useState<ResumeLibraryRowSelection>({});

  const updateRouteSearch = useCallback(
    (updates: Record<string, number | string | undefined>) => {
      void router.navigate({
        params: { slug },
        replace: true,
        resetScroll: false,
        search: (prev: SearchParamsRecord) => {
          const next = Object.fromEntries(
            Object.entries(coerceSearchParams(prev)).filter(
              ([key]) => !(Object.hasOwn(updates, key) && updates[key] === undefined),
            ),
          ) as SearchParamsRecord;
          for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
              next[key] = value;
            }
          }
          return next;
        },
        to: "/w/$slug/studio/resumes",
      } as never);
    },
    [router, slug],
  );

  const updateRouteSearchAndResetPage = useCallback(
    (updates: Record<string, string | undefined>) => {
      setRowSelection({});
      updateRouteSearch({ ...updates, page: 1 });
    },
    [updateRouteSearch],
  );

  const setFilter = useCallback(
    (key: keyof ResumeFilters & string, value: string) => {
      updateRouteSearchAndResetPage({ [key]: value || undefined });
    },
    [updateRouteSearchAndResetPage],
  );

  const onFilterChange = useCallback(
    (key: string, value: string) => {
      setFilter(key as keyof ResumeFilters & string, value);
    },
    [setFilter],
  );

  const filterValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of RESUME_LIBRARY_FILTER_KEYS) {
      out[key] = query.filters[key];
    }
    return out;
  }, [query.filters]);

  const canResetFilters = RESUME_LIBRARY_FILTER_KEYS.some(
    (key) => query.filters[key] !== EMPTY_FILTERS[key],
  );

  const onResetFilters = useCallback(
    (clearedValues?: Record<string, string>) => {
      setRowSelection({});
      const updates: Record<string, number | string | undefined> = { page: 1 };
      if (clearedValues) {
        for (const [key, value] of Object.entries(clearedValues)) {
          updates[key] = value || undefined;
        }
      } else {
        for (const key of RESUME_LIBRARY_FILTER_KEYS) {
          updates[key] = EMPTY_FILTERS[key] || undefined;
        }
      }
      updateRouteSearch(updates);
    },
    [updateRouteSearch],
  );

  const sorting = useMemo(
    () => (query.sortBy ? [{ desc: query.sortOrder === "desc", id: query.sortBy }] : []),
    [query.sortBy, query.sortOrder],
  );

  const bind = useMemo(
    () => ({
      canResetFilters,
      filterValues,
      onFilterChange,
      onRefresh,
      onResetFilters,
      rowSelection,
    }),
    [canResetFilters, filterValues, onFilterChange, onRefresh, onResetFilters, rowSelection],
  );

  return useMemo(
    () => ({
      bind,
      deferredFilters,
      filters: query.filters,
      rowSelection,
      setFilter,
      setRowSelection,
      sorting,
    }),
    [bind, deferredFilters, query.filters, rowSelection, setFilter, setRowSelection, sorting],
  );
}
