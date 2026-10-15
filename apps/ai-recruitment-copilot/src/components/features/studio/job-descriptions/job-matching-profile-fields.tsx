"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { jobMatchingProfileSchema } from "@arc/db-schema/job-matching";
import type { JobMatchingProfile } from "@arc/db-schema/job-matching";
import { rpc } from "@/lib/client/rpc";
import { rpcFetch } from "@/lib/client/api/rpc-fetch";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProfileResponse {
  profile: JobMatchingProfile | null;
  confirmed: boolean;
  stale: boolean;
}
const tagFields = [
  ["responsibilities", "主要职责"],
  ["requiredSkills", "核心技能"],
  ["preferredSkills", "加分技能"],
  ["domains", "行业与业务领域"],
] as const;

function ProfileEditor({
  initial,
  disabled,
  onSave,
  readOnly,
}: {
  initial: JobMatchingProfile;
  disabled: boolean;
  onSave: (profile: JobMatchingProfile) => void;
  readOnly: boolean;
}) {
  const [profile, setProfile] = useState(initial);
  const [years, setYears] = useState(initial.minimumWorkYears?.toString() ?? "");
  const [tags, setTags] = useState(() =>
    Object.fromEntries(tagFields.map(([key]) => [key, initial[key].join("、")])),
  );
  const id = "job-matching-profile";
  return (
    <FieldGroup className="gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            ["roleFamily", "岗位职能"],
            ["seniority", "级别与资历"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key}>
            <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
            <Input
              id={`${id}-${key}`}
              disabled={disabled || readOnly}
              maxLength={120}
              value={profile[key]}
              onChange={(event) => setProfile((old) => ({ ...old, [key]: event.target.value }))}
            />
          </Field>
        ))}
      </div>
      {tagFields.map(([key, label]) => (
        <Field key={key}>
          <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
          <Textarea
            id={`${id}-${key}`}
            disabled={disabled || readOnly}
            value={tags[key]}
            rows={key === "responsibilities" ? 3 : 2}
            placeholder="多项内容用顿号或换行分隔"
            onChange={(event) => setTags((old) => ({ ...old, [key]: event.target.value }))}
          />
        </Field>
      ))}
      <div className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${id}-years`}>最低工作年限</FieldLabel>
          <Input
            id={`${id}-years`}
            disabled={disabled || readOnly}
            type="number"
            min={0}
            max={60}
            step="0.5"
            placeholder="未要求"
            value={years}
            onChange={(event) => setYears(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-education`}>最低学历</FieldLabel>
          <Select
            disabled={disabled || readOnly}
            value={profile.minimumEducation ?? "none"}
            onValueChange={(value) =>
              setProfile((old) => ({
                ...old,
                minimumEducation:
                  value === "none" ? null : (value as JobMatchingProfile["minimumEducation"]),
              }))
            }
          >
            <SelectTrigger id={`${id}-education`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {["none", "专科", "本科", "硕士", "博士"].map((value) => (
                  <SelectItem value={value} key={value}>
                    {value === "none" ? "未要求" : value}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {readOnly ? null : (
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              const result = jobMatchingProfileSchema.safeParse({
                ...profile,
                ...Object.fromEntries(
                  tagFields.map(([key]) => [
                    key,
                    (tags[key] ?? "")
                      .split(/[\n,，、]/)
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  ]),
                ),
                minimumWorkYears: years.trim() === "" ? null : Number(years),
              });
              if (!result.success) {
                toast.error(
                  "请检查画像字段：每项不超过 120 字，每组不超过 30 项，工作年限为 0–60 年。",
                );
                return;
              }
              onSave(result.data);
            }}
          >
            {disabled ? "正在保存…" : "保存并确认画像"}
          </Button>
        </div>
      )}
    </FieldGroup>
  );
}

export function JobMatchingProfileFields({
  slug,
  jobId,
  readOnly,
}: {
  slug: string;
  jobId: string;
  readOnly: boolean;
}) {
  const client = useQueryClient();
  const key = ["job-matching-profile", slug, jobId];
  const api = rpc.api.w[":slug"].studio["job-descriptions"][":id"]["matching-profile"];
  const profile = useQuery({
    queryFn: () =>
      rpcFetch<ProfileResponse>(api.$get({ param: { id: jobId, slug } }), "加载岗位匹配画像失败"),
    queryKey: key,
    staleTime: 0,
  });
  const analyze = useMutation({
    mutationFn: () =>
      rpcFetch<ProfileResponse>(
        api.analyze.$post({ param: { id: jobId, slug } }),
        "分析岗位画像失败",
      ),
    onError: (error) => toast.error(error.message),
    onSuccess: (data) => client.setQueryData(key, data),
  });
  const save = useMutation({
    mutationFn: (json: JobMatchingProfile) =>
      rpcFetch<ProfileResponse>(api.$put({ json, param: { id: jobId, slug } }), "保存岗位画像失败"),
    onError: (error) => toast.error(error.message),
    onSuccess: (data) => {
      client.setQueryData(key, data);
      toast.success("岗位匹配画像已保存");
    },
  });
  return (
    <details className="mt-5 rounded-lg border p-4">
      <summary className="cursor-pointer font-medium text-sm">岗位匹配画像</summary>
      <div className="mt-4 space-y-4">
        <p className="text-muted-foreground text-sm">
          用于智能上传时推荐岗位，系统会在首次使用时自动分析并复用。画像依据已保存的岗位内容生成，修改岗位内容后请先保存岗位。可在此调整职能、技能与要求；保存确认后，明确的学历和年限门槛会参与筛选。
        </p>
        {profile.isPending ? (
          <output className="text-muted-foreground text-sm">正在加载画像…</output>
        ) : null}
        {profile.isError ? (
          <div>
            <p role="alert" className="text-destructive text-sm">
              {profile.error.message}
            </p>
            <Button type="button" variant="outline" onClick={() => void profile.refetch()}>
              重新加载
            </Button>
          </div>
        ) : null}
        {profile.data?.stale ? (
          <p className="text-muted-foreground text-sm">
            岗位内容已更新，请检查并调整画像后再次保存确认。
          </p>
        ) : null}
        {profile.data?.profile ? (
          <ProfileEditor
            key={`${jobId}:${JSON.stringify(profile.data)}`}
            initial={profile.data.profile}
            disabled={save.isPending}
            readOnly={readOnly}
            onSave={(value) => save.mutate(value)}
          />
        ) : null}
        {profile.data && !profile.data.profile && !readOnly ? (
          <Button
            type="button"
            variant="outline"
            disabled={analyze.isPending}
            onClick={() => analyze.mutate()}
          >
            {analyze.isPending ? "正在分析岗位…" : "分析岗位画像"}
          </Button>
        ) : null}
        {profile.data && !profile.data.profile && readOnly ? (
          <p className="text-muted-foreground text-sm">尚未生成画像</p>
        ) : null}
      </div>
    </details>
  );
}
