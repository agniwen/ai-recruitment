"use client";

import {
  IconAlertCircle,
  IconCircleCheck,
  IconLoader2,
  IconPhoto,
  IconPlayerPlay,
  IconRobot,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  PlatformAgentTestResult,
  PlatformAgentTestsOverview,
  PlatformAgentTestTarget,
} from "@arc/shared/platform-agent-tests";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { rpcFetch } from "@/lib/client/api";
import { rpc } from "@/lib/client/rpc";

function formatTestTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function AgentTestResult({ result }: { result: PlatformAgentTestResult }) {
  const passed = result.status === "passed";
  return (
    <Alert variant={passed ? "default" : "destructive"}>
      {passed ? <IconCircleCheck /> : <IconAlertCircle />}
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {passed ? "连接成功" : "连接失败"}
        <Badge variant={passed ? "success" : "danger"}>{result.latencyMs} ms</Badge>
      </AlertTitle>
      <AlertDescription>
        <p>{formatTestTime(result.testedAt)}</p>
        {result.responsePreview ? (
          <p className="break-words font-mono text-foreground">{result.responsePreview}</p>
        ) : null}
        {result.error ? <p className="break-words">{result.error}</p> : null}
      </AlertDescription>
    </Alert>
  );
}

function AgentTestCard({ target }: { target: PlatformAgentTestTarget }) {
  const isAlibaba = target.id === "alibaba";
  const mutation = useMutation({
    mutationFn: () =>
      isAlibaba
        ? rpcFetch<PlatformAgentTestResult>(
            rpc.api.platform["agent-tests"].alibaba.$post(),
            "Alibaba 模型测试失败",
          )
        : rpcFetch<PlatformAgentTestResult>(
            rpc.api.platform["agent-tests"]["qwen-ocr"].$post(),
            "Qwen OCR 测试失败",
          ),
  });
  const Icon = isAlibaba ? IconRobot : IconPhoto;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-5 text-muted-foreground" />
          {target.title}
        </CardTitle>
        <CardDescription>
          {isAlibaba
            ? "发送一条最短文本请求，验证兼容接口、密钥与默认模型。"
            : "发送一张内置小图，验证视觉模型能否完成真实 OCR 请求。"}
        </CardDescription>
        <CardAction>
          <Badge variant={target.ready ? "success" : "warning"}>
            {target.ready ? "配置完整" : "配置不完整"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardPanel className="flex flex-col gap-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
          <dt className="text-muted-foreground">Base URL</dt>
          <dd className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all">{target.endpoint ?? "未配置"}</code>
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              {target.baseUrlConfigured
                ? `${target.envName} 已配置`
                : `${target.envName} 未显式配置`}
            </p>
          </dd>
          <dt className="text-muted-foreground">模型</dt>
          <dd className="break-all font-mono">{target.model ?? "未配置"}</dd>
          <dt className="text-muted-foreground">访问密钥</dt>
          <dd>{target.credentialConfigured ? "已配置（内容已隐藏）" : "未配置"}</dd>
        </dl>

        <div className="flex justify-end">
          <Button disabled={!target.ready || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <IconLoader2 className="animate-spin" /> : <IconPlayerPlay />}
            {mutation.isPending ? "测试中" : "运行测试"}
          </Button>
        </div>

        {mutation.data ? <AgentTestResult result={mutation.data} /> : null}
        {mutation.error ? (
          <Alert variant="destructive">
            <IconAlertCircle />
            <AlertTitle>请求失败</AlertTitle>
            <AlertDescription>{mutation.error.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardPanel>
    </Card>
  );
}

export function AgentTestsPanel() {
  const query = useQuery({
    queryFn: () =>
      rpcFetch<PlatformAgentTestsOverview>(
        rpc.api.platform["agent-tests"].overview.$get(),
        "加载 Agent 测试配置失败",
      ),
    queryKey: ["platform-agent-tests-overview"],
  });

  if (query.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (query.error || !query.data) {
    return (
      <Alert className="my-6" variant="destructive">
        <IconAlertCircle />
        <AlertTitle>配置加载失败</AlertTitle>
        <AlertDescription>{query.error?.message ?? "暂无可用配置"}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Agent 测试</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          运行真实模型请求以检查 Base URL、密钥和模型是否可用。每次测试会产生少量模型调用费用。
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {query.data.targets.map((target) => (
          <AgentTestCard key={target.id} target={target} />
        ))}
      </div>
    </div>
  );
}
