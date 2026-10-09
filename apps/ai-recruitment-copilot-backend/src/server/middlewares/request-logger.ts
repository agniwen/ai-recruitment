import { logger } from "hono/logger";

// Invitation paths are credentials. Keep endpoint, status and duration without the token or query.
export function redactInterviewLogLine(message: string) {
  return message
    .replaceAll(
      /(\/(?:api\/public\/human-interview-meetings|human-interview)\/(?:interviewer\/)?)[^/?\s]+(?:\?[^\s]*)?/g,
      "$1[REDACTED]",
    )
    .replaceAll(
      /(\/(?:api\/platform\/interview-logs|api\/public\/human-interview-meetings|human-interview)[^?\s]*)\?[^\s]*/g,
      "$1",
    );
}

export const requestLogger = logger((message) => console.log(redactInterviewLogLine(message)));
