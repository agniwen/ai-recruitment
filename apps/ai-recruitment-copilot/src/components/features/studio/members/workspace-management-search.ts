export const DEFAULT_TAB = "members";
const WORKSPACE_MANAGEMENT_TABS = ["members", "groups"] as const;

export type WorkspaceManagementTab = (typeof WORKSPACE_MANAGEMENT_TABS)[number];

export interface WorkspaceManagementSearch {
  tab?: WorkspaceManagementTab;
}

export function parseWorkspaceManagementTab(value: unknown): WorkspaceManagementTab {
  return value === "groups" ? "groups" : DEFAULT_TAB;
}

export function coerceWorkspaceManagementSearch(
  search: Record<string, unknown>,
): WorkspaceManagementSearch {
  const tab = parseWorkspaceManagementTab(search.tab);
  return tab === DEFAULT_TAB ? {} : { tab };
}

export function buildWorkspaceManagementSearch(
  previous: WorkspaceManagementSearch,
  tab: WorkspaceManagementTab,
): WorkspaceManagementSearch {
  if (tab === DEFAULT_TAB) {
    const { tab: _tab, ...rest } = previous;
    return rest;
  }
  return { ...previous, tab };
}
