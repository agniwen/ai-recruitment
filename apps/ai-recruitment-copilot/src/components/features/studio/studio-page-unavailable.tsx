import { Link } from "@tanstack/react-router";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";

export function StudioPageUnavailable() {
  const slug = useWorkspaceSlug();
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-lg font-medium">无法访问此页面</h1>
      <p className="text-muted-foreground text-sm">
        页面不存在，或你没有查看权限。可从侧栏选择其他页面。
      </p>
      <Link className="text-sm underline underline-offset-4" params={{ slug }} to="/w/$slug">
        返回工作区
      </Link>
    </div>
  );
}
