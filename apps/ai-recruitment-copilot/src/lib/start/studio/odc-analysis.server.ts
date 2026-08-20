import { LRUCache } from "lru-cache";
import type { OdcAnalysisFilters } from "@arc/shared/odc-analysis";
import { loadOdcAnalysis } from "@arc/ai-recruitment-copilot-backend/server/routes/studio/routes/odc-analysis/dao";

type OdcAnalysisCacheValue = Awaited<ReturnType<typeof loadOdcAnalysis>>;

const cache = new LRUCache<string, Promise<OdcAnalysisCacheValue>>({
  max: 100,
  ttl: 10_000,
});

function cacheKey(organizationId: string, filters: OdcAnalysisFilters): string {
  return JSON.stringify([
    organizationId,
    filters.from ?? null,
    filters.to ?? null,
    filters.jobDescriptionIds,
    filters.role ?? null,
  ]);
}

export function loadCachedOdcAnalysis(
  organizationId: string,
  filters: OdcAnalysisFilters,
): Promise<OdcAnalysisCacheValue> {
  const key = cacheKey(organizationId, filters);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const promise = (async () => {
    try {
      return await loadOdcAnalysis(organizationId, filters);
    } catch (error) {
      cache.delete(key);
      throw error;
    }
  })();
  cache.set(key, promise);
  return promise;
}
