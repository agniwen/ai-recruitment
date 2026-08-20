"use client";

import { IconBuilding } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";
import { PermissionGate } from "@/components/features/permission/permission-gate";
import { ContributionCalendar } from "@/components/features/studio/charts/contribution-calendar";
import { MailIngestAccountCard } from "@/components/features/studio/profile/mail-ingest-account-card";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "@/components/features/studio/profile/profile-settings-ui";
import { PageHeader } from "@/components/features/studio/page-header";
import { getWorkspaceRoleLabel } from "@/components/features/studio/members/role-display";
import type { WorkspaceRole } from "@/components/features/studio/members/role-display";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateOnly } from "@arc/shared/utils/time";
import { USER_TELEGRAM_MAX_LENGTH } from "@arc/shared/user-profile";
import { useWorkspaceMemberRole, useWorkspaceSlug } from "@/lib/client/workspace-context";
import { authClient } from "@/lib/client/auth-client";
import { rpcFetch } from "@/lib/client/api";
import { studioProfileKeys } from "@/lib/client/api/query-keys";
import { rpc } from "@/lib/client/rpc";
import { cn } from "@arc/shared/utils";

const WHITESPACE_REGEX = /\s+/u;
const PROFILE_NAME_MAX_LENGTH = 120;
const AUTOSAVE_DEBOUNCE_MS = 1000;

interface ProfileDraft {
  name: string;
  telegram: string;
}

function normalizeProfileDraft(profile: ProfileDraft): ProfileDraft {
  return {
    name: profile.name.trim(),
    telegram: profile.telegram.trim(),
  };
}

function profilesMatch(left: ProfileDraft, right: ProfileDraft): boolean {
  return left.name === right.name && left.telegram === right.telegram;
}

const ROLE_BADGE_VARIANT: Record<WorkspaceRole, "default" | "secondary" | "outline"> = {
  admin: "default",
  member: "secondary",
  noAccess: "outline",
  owner: "default",
};

function getInitials(name?: string | null, email?: string | null) {
  const source = (name ?? email ?? "").trim();
  if (!source) {
    return "U";
  }
  const words = source.split(WHITESPACE_REGEX).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

function saveStatusLabel(status: SaveStatus): string | null {
  switch (status) {
    case "saving": {
      return "保存中…";
    }
    case "saved": {
      return "已保存";
    }
    case "error": {
      return "保存失败";
    }
    case "dirty": {
      return "未保存";
    }
    default: {
      return null;
    }
  }
}

function ProfileHero({
  email,
  image,
  name,
}: {
  email?: string | null;
  image?: string | null;
  name: string;
}) {
  const displayName = name || "未命名用户";

  return (
    <div className="flex flex-col items-center gap-3 py-2 text-center">
      <Avatar className="size-20 ring-1 ring-border" size="lg">
        <AvatarImage alt={displayName} src={image ?? undefined} />
        <AvatarFallback className="text-lg">{getInitials(name, email)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 space-y-1">
        <p className="truncate font-semibold text-lg tracking-tight">{displayName}</p>
        {email ? <p className="text-muted-foreground text-xs">{email}</p> : null}
      </div>
    </div>
  );
}

interface ProfileActivityResponse {
  dailyAdded: { count: number; day: string }[];
}

function summarizeProfileActivity(data: ProfileActivityResponse) {
  let peak = 0;
  let total = 0;
  for (const row of data.dailyAdded) {
    total += row.count;
    peak = Math.max(peak, row.count);
  }
  return { dailyAdded: data.dailyAdded, peak, total };
}

const EMPTY_ACTIVITY_SUMMARY = { dailyAdded: [], peak: 0, total: 0 } as const;

function ActivitySection() {
  const slug = useWorkspaceSlug();
  const activityQuery = useQuery({
    queryFn: () =>
      rpcFetch<ProfileActivityResponse>(
        rpc.api.w[":slug"].studio.workspace["my-activity"].$get({ param: { slug } }),
        "加载个人活动失败",
      ),
    queryKey: studioProfileKeys.activity(slug),
    select: summarizeProfileActivity,
  });

  const activity = activityQuery.data ?? EMPTY_ACTIVITY_SUMMARY;

  let body: React.ReactNode = (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
        <span>
          一年新增{" "}
          <span className="font-mono font-medium text-foreground tabular-nums">
            {activity.total}
          </span>
        </span>
        <span className="text-border">·</span>
        <span>
          单日峰值{" "}
          <span className="font-mono font-medium text-foreground tabular-nums">
            {activity.peak}
          </span>
        </span>
      </div>
      <ContributionCalendar
        dailyAdded={activity.dailyAdded}
        emptyMessage="过去一年你还没有入库候选人"
        unitLabel="份"
      />
    </div>
  );

  if (activityQuery.isPending) {
    body = <Skeleton className="h-28 w-full rounded-lg" />;
  } else if (activityQuery.isError) {
    body = (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm">
        {activityQuery.error instanceof Error ? activityQuery.error.message : "加载个人活动失败"}
      </p>
    );
  }

  return body;
}

function OrganizationSection({
  currentRole,
  currentSlug,
  organizations,
}: {
  currentRole: WorkspaceRole | null;
  currentSlug: string;
  organizations: {
    createdAt: Date | string;
    id: string;
    name: string;
    slug: string;
  }[];
}) {
  return (
    <SettingsSection description="当前账号所属工作区与角色。" title="我的工作区">
      <SettingsGroup>
        {organizations.length === 0 ? (
          <div className="px-3.5 py-3 text-muted-foreground text-sm">尚未加入任何工作区</div>
        ) : (
          organizations.map((organization) => {
            const isActive = organization.slug === currentSlug;
            return (
              <div
                className="flex items-center justify-between gap-3 px-3.5 py-2.5"
                key={organization.id}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-md border",
                      isActive
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "bg-muted/40 text-muted-foreground",
                    )}
                  >
                    <IconBuilding className="size-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p
                      className={cn("truncate font-medium text-sm", isActive && "text-foreground")}
                    >
                      {organization.name}
                    </p>
                    <p className="truncate text-muted-foreground text-xs">
                      /w/{organization.slug} · 加入于 {formatDateOnly(organization.createdAt)}
                    </p>
                  </div>
                </div>
                {isActive && currentRole ? (
                  <Badge variant={ROLE_BADGE_VARIANT[currentRole]}>
                    {getWorkspaceRoleLabel(currentRole)}
                  </Badge>
                ) : null}
              </div>
            );
          })
        )}
      </SettingsGroup>
    </SettingsSection>
  );
}

export function ProfilePage() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const { data: listOrganizations } = authClient.useListOrganizations();
  const currentSlug = useWorkspaceSlug();
  const workspaceMemberRole = useWorkspaceMemberRole() as WorkspaceRole;
  const user = session?.user;
  const organizations = listOrganizations ?? [];

  const [profile, setProfile] = useState<ProfileDraft>({ name: "", telegram: "" });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const lastSavedProfileRef = useRef<ProfileDraft>({ name: "", telegram: "" });
  const latestProfileRef = useRef<ProfileDraft>({ name: "", telegram: "" });
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const savedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const next = { name: user?.name ?? "", telegram: user?.telegram ?? "" };
    setProfile(next);
    lastSavedProfileRef.current = next;
    latestProfileRef.current = next;
    setSaveStatus("idle");
  }, [user?.name, user?.telegram]);

  useEffect(() => {
    latestProfileRef.current = profile;
  }, [profile]);

  const performSave = useCallback(async () => {
    const normalized = normalizeProfileDraft(latestProfileRef.current);
    if (!normalized.name) {
      setSaveStatus("error");
      toast.error("姓名不能为空");
      return;
    }
    if (profilesMatch(normalized, lastSavedProfileRef.current)) {
      setSaveStatus("idle");
      return;
    }

    const seq = (requestSeqRef.current += 1);
    setSaveStatus("saving");

    const { error } = await authClient.updateUser({
      name: normalized.name,
      telegram: normalized.telegram || null,
    });

    if (seq !== requestSeqRef.current || !mountedRef.current) {
      return;
    }

    if (error) {
      setSaveStatus("error");
      toast.error(error.message ?? "保存失败");
      return;
    }

    lastSavedProfileRef.current = normalized;
    setProfile(normalized);
    setSaveStatus("saved");
    await refetch();

    if (savedResetTimerRef.current) {
      clearTimeout(savedResetTimerRef.current);
    }
    savedResetTimerRef.current = setTimeout(() => {
      if (mountedRef.current && profilesMatch(lastSavedProfileRef.current, normalized)) {
        setSaveStatus("idle");
      }
    }, 2000);
  }, [refetch]);

  const debouncedSave = useDebouncedCallback(() => {
    void performSave();
  }, AUTOSAVE_DEBOUNCE_MS);

  const handleProfileChange = useCallback(
    (field: keyof ProfileDraft, value: string) => {
      const next = { ...latestProfileRef.current, [field]: value };
      setProfile(next);
      latestProfileRef.current = next;
      if (profilesMatch(normalizeProfileDraft(next), lastSavedProfileRef.current)) {
        setSaveStatus("idle");
        debouncedSave.cancel();
        return;
      }
      setSaveStatus("dirty");
      debouncedSave();
    },
    [debouncedSave],
  );

  const handleSaveNow = useCallback(() => {
    debouncedSave.cancel();
    void performSave();
  }, [debouncedSave, performSave]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      debouncedSave.flush();
      if (savedResetTimerRef.current) {
        clearTimeout(savedResetTimerRef.current);
      }
    };
  }, [debouncedSave]);

  const heroName = profile.name.trim() || user?.name || "";
  const profileSaveLabel = saveStatusLabel(saveStatus);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <PageHeader description="管理个人资料、个人活动和所属工作区。" title="个人中心" />

      <ProfileHero email={user?.email} image={user?.image} name={heroName} />

      <ActivitySection />

      <SettingsSection title="账号资料">
        <SettingsGroup>
          <SettingsRow
            description="显示在成员列表、邀请记录和个人菜单中。失焦或停顿约 1 秒后自动保存。"
            htmlFor="profile-name"
            label="显示名称"
          >
            <div className="flex flex-col gap-1">
              <Input
                id="profile-name"
                autoComplete="name"
                disabled={isPending || saveStatus === "saving"}
                maxLength={PROFILE_NAME_MAX_LENGTH}
                onBlur={handleSaveNow}
                onChange={(event) => handleProfileChange("name", event.target.value)}
                placeholder="请输入姓名"
                value={profile.name}
              />
              {profileSaveLabel ? (
                <p
                  className={cn(
                    "text-[11px]",
                    saveStatus === "error" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {profileSaveLabel}
                </p>
              ) : null}
            </div>
          </SettingsRow>
          <SettingsRow
            description="用于工作联系，可不填写。失焦或停顿约 1 秒后自动保存。"
            htmlFor="profile-telegram"
            label="TG 号"
          >
            <Input
              id="profile-telegram"
              autoComplete="off"
              disabled={isPending || saveStatus === "saving"}
              maxLength={USER_TELEGRAM_MAX_LENGTH}
              onBlur={handleSaveNow}
              onChange={(event) => handleProfileChange("telegram", event.target.value)}
              placeholder="例如 @username"
              value={profile.telegram}
            />
          </SettingsRow>
          <SettingsRow description="由登录方式提供，不可在此修改。" label="登录邮箱">
            <Input disabled readOnly value={user?.email ?? ""} />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>

      <OrganizationSection
        currentRole={workspaceMemberRole}
        currentSlug={currentSlug}
        organizations={organizations}
      />

      <PermissionGate resource="member" action="update">
        <MailIngestAccountCard />
      </PermissionGate>
    </div>
  );
}
