import type { QueryClient } from "@tanstack/react-query";

export function invalidateSscResponsibilityQueries(client: QueryClient, slug: string) {
  return Promise.all(
    ["studio-ssc-responsibilities", "studio-ssc-candidates", "workspace-members"].map((key) =>
      client.invalidateQueries({ queryKey: [key, slug] }),
    ),
  );
}
