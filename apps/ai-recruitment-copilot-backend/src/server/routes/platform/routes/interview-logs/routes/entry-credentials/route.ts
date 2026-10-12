import { factory } from "../../../../../../factory";
import { loadMeetingEntryCredentials } from "./dao";

// Administrator permission and no-store are inherited from the interview logs router.
export const meetingEntryCredentialsRouter = factory
  .createApp()
  .get("/", async (c) =>
    c.json(await loadMeetingEntryCredentials(c.req.param("meetingId") ?? ""), 200),
  );
