import { sql } from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { buildListTextFilterWhere } from "@arc/ai-recruitment-copilot-backend/lib/server/db/list-text-filters";

export function buildResumeAtomicSearch(
  columns: {
    candidateName: SQLWrapper;
    candidateEmail: SQLWrapper;
    candidatePhone: SQLWrapper;
    resumeFileName: SQLWrapper;
    targetRole: SQLWrapper;
    resumeProfile: SQLWrapper;
  },
  raw?: string,
) {
  return buildListTextFilterWhere("resumes", raw, {
    candidateName: columns.candidateName,
    company: sql`(select string_agg(item, ' ') from jsonb_array_elements_text(jsonb_path_query_array(${columns.resumeProfile}, '$.workExperiences[*].company')) item)`,
    email: columns.candidateEmail,
    phone: columns.candidatePhone,
    resumeFileName: columns.resumeFileName,
    school: sql`concat_ws(' ', (select string_agg(item, ' ') from jsonb_array_elements_text(jsonb_path_query_array(${columns.resumeProfile}, '$.educationExperiences[*].school')) item), (select string_agg(item, ' ') from jsonb_array_elements_text(jsonb_path_query_array(${columns.resumeProfile}, '$.schools[*]')) item))`,
    targetRole: columns.targetRole,
  });
}
