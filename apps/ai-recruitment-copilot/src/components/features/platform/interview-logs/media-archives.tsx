import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchMediaArchives } from "./media-api";

export function MediaArchivesPanel({ onOpen }: { onOpen: (meetingId: string) => void }) {
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryFn: ({ signal }) => fetchMediaArchives(page, search, signal),
    queryKey: ["platform", "interview-media-archives", { page, search }],
    retry: 1,
    staleTime: 10_000,
  });
  return (
    <section className="space-y-4" aria-label="长期留底档案">
      <p className="text-sm text-muted-foreground">
        音视频档案独立长期保存。即使普通事件日志到期或会议被删除，也可以在这里查看留底。
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(draft.trim());
          setPage(1);
        }}
      >
        <Input
          className="max-w-sm"
          aria-label="搜索留底档案"
          placeholder="会议名称或会议 ID"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit">搜索</Button>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          刷新
        </Button>
      </form>
      {query.isPending ? <p>正在加载留底档案…</p> : null}
      {query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      ) : null}
      {query.data?.records.map((room) => (
        <div
          key={room.roomSid}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
        >
          <div>
            <p className="font-medium">{room.meetingTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(room.startedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} ·{" "}
              {room.meetingId}
            </p>
          </div>
          <Button variant="outline" onClick={() => onOpen(room.meetingId)}>
            查看留底与日志
          </Button>
        </div>
      ))}
      {query.data && !query.data.records.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">暂无留底档案</p>
      ) : null}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          共 {query.data?.total ?? 0} 场会议连接 · 第 {page} 页
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={page <= 1 || query.isFetching}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            disabled={page * 20 >= (query.data?.total ?? 0) || query.isFetching}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </section>
  );
}
