export interface JobMatchingIndexStatus {
  configurationError: string | null;
  failed: number;
  indexed: number;
  pending: number;
  profiles: number;
  total: number;
  vectorError: string | null;
  vectorPoints: number | null;
}
