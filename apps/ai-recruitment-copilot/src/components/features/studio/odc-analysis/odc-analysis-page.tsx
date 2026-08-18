import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { PageHeader } from "@/components/features/studio/page-header";

export function OdcAnalysisPage() {
  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4 md:gap-6">
      <PageHeader title="ODC分析" description="查看 ODC 相关招聘数据分析。" />
      <Empty className="min-h-56 border border-border">
        <EmptyHeader>
          <EmptyTitle>ODC分析数据暂未配置</EmptyTitle>
          <EmptyDescription>完成 ODC 分析数据源配置后，这里会展示对应的分析结果。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
