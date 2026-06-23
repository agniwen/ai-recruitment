import type { HiringUnitRecord } from "@arc/shared/hiring-units";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "../rpc-fetch";

export async function fetchSelectableHiringUnits(slug: string): Promise<HiringUnitRecord[]> {
  const payload = await rpcFetch<{ records: HiringUnitRecord[] }>(
    rpc.api.w[":slug"].studio["hiring-units"].selectable.$get({
      param: { slug },
    }),
    "加载可选用人组织失败",
  );
  return payload.records;
}
