"use client";

import { IconBan, IconCircleCheck, IconMail, IconPencil, IconTrash } from "@tabler/icons-react";
/* oxlint-disable no-use-before-define -- helper components defined below export component for top-down readability */
// Offer 阶段的详情面板内容：
//   - 顶部：候选人期望（薪资 / 现 base / 期望入职日）—— 可编辑，partial merge
//   - 下方：Offer 草稿版本时间线（version desc）
//   - 新建 Offer / 编辑 draft / 发送 / 记录响应 / 撤回
//   - 候选人接受 Offer 时弹二次确认，请上层走「标记结案 hired」流程
//
// Offer-stage panel: candidate expectations inline form + offer draft
// timeline. Draft → sent → respond / cancel flows; on "accepted" we prompt
// the caller to launch the close flow.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { toast } from "sonner";
import { getOfferDraftStatusMeta } from "@arc/db-schema/studio-interviews";
import { MAX_OFFER_APPROVAL_ATTACHMENT_BYTES } from "@arc/shared/studio-pipeline-stages";
import type { OfferDraftRecord } from "@arc/shared/studio-pipeline-stages";
import {
  cancelOfferDraft,
  deleteOfferDraft,
  fetchStudioResume,
  offerApprovalAttachmentUrl,
  patchOfferDraft,
  patchOfferDraftWithAttachment,
  updateCandidateExpectations,
} from "@/lib/client/api";
import { useWorkspaceSlug } from "@/lib/client/workspace-context";
import { DatePicker } from "@/components/date-time-picker";
import { Badge } from "@/components/ui/badge";
import { EmptyValue } from "@/components/features/display/empty-value";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EntityDeleteDialog } from "./entity-delete-dialog";
import { OfferAttachmentPreview } from "./offer-attachment-preview";
import {
  OfferDraftFormFields,
  buildOfferDraftPayload,
  createOfferFormFieldSetter,
  formatDate,
  formatIsoDateOnly,
  offerFormStateFromDraft,
} from "./offer-stage-form";
import type { OfferFormState } from "./offer-stage-form";

export function CandidateExpectationsBlock({
  candidateId,
  disabled,
}: {
  candidateId: string;
  disabled?: boolean;
}) {
  const slug = useWorkspaceSlug();
  const queryClient = useQueryClient();
  const { data: resume } = useQuery({
    enabled: !!candidateId,
    queryFn: () => fetchStudioResume(slug, candidateId),
    queryKey: ["studio-resumes", slug, "detail", candidateId],
  });
  const meta = resume?.candidateExpectationsMeta;

  const [editing, setEditing] = useState(false);
  const [expectedSalary, setExpectedSalary] = useState("");
  const [currentSalary, setCurrentSalary] = useState("");
  const [earliestJoiningDate, setEarliestJoiningDate] = useState("");
  const [notes, setNotes] = useState("");

  // 打开编辑时同步当前值。
  // Sync form when entering edit mode.
  useEffect(() => {
    if (editing) {
      setExpectedSalary(meta?.expectedSalary ? String(meta.expectedSalary) : "");
      setCurrentSalary(meta?.currentSalary ? String(meta.currentSalary) : "");
      setEarliestJoiningDate(meta?.earliestJoiningDate ?? "");
      setNotes(meta?.notes ?? "");
    }
  }, [editing, meta]);

  const mutation = useMutation({
    mutationFn: () => {
      const parsedExpected = expectedSalary === "" ? null : Number(expectedSalary);
      const parsedCurrent = currentSalary === "" ? null : Number(currentSalary);
      if (
        (parsedExpected !== null && (Number.isNaN(parsedExpected) || parsedExpected < 0)) ||
        (parsedCurrent !== null && (Number.isNaN(parsedCurrent) || parsedCurrent < 0))
      ) {
        throw new Error("薪资需为非负整数");
      }
      return updateCandidateExpectations(slug, candidateId, {
        currentSalary: parsedCurrent,
        earliestJoiningDate: earliestJoiningDate || null,
        expectedSalary: parsedExpected,
        notes: notes.trim() || null,
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "保存失败"),
    onSuccess: () => {
      toast.success("已更新候选人期望");
      void queryClient.invalidateQueries({
        queryKey: ["studio-resumes", slug, "detail", candidateId],
      });
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <Card className="gap-0 rounded-lg py-0">
        <CardContent className="p-4">
          <h4 className="mb-3 font-medium text-sm">编辑候选人期望</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-sm" htmlFor="exp-salary">
                期望月薪
              </Label>
              <Input
                id="exp-salary"
                inputMode="numeric"
                min={0}
                onChange={(e) => setExpectedSalary(e.target.value)}
                placeholder="如 30000"
                type="number"
                value={expectedSalary}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-sm" htmlFor="cur-salary">
                当前月薪
              </Label>
              <Input
                id="cur-salary"
                inputMode="numeric"
                min={0}
                onChange={(e) => setCurrentSalary(e.target.value)}
                placeholder="如 25000"
                type="number"
                value={currentSalary}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label className="text-sm" htmlFor="exp-joining">
                最早入职日
              </Label>
              <DatePicker
                id="exp-joining"
                onValueChange={setEarliestJoiningDate}
                value={earliestJoiningDate}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label className="text-sm" htmlFor="exp-notes">
                备注
              </Label>
              <Textarea
                id="exp-notes"
                maxLength={1000}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="如「希望远程」「期权敏感」"
                rows={2}
                value={notes}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              disabled={mutation.isPending}
              onClick={() => setEditing(false)}
              size="sm"
              variant="outline"
            >
              取消
            </Button>
            <Button disabled={mutation.isPending} onClick={() => mutation.mutate()} size="sm">
              {mutation.isPending ? "保存中…" : "保存"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-0 rounded-lg py-0">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h4 className="font-medium text-sm">候选人期望</h4>
            <p className="text-muted-foreground text-xs">
              发 Offer 前先收集候选人期望，做议价参考。
            </p>
          </div>
          {disabled ? null : (
            <Button onClick={() => setEditing(true)} size="sm" variant="ghost">
              <IconPencil className="size-3.5" />
              编辑
            </Button>
          )}
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <ExpectationField
            label="期望月薪"
            value={meta?.expectedSalary ? `¥ ${meta.expectedSalary.toLocaleString()}` : null}
          />
          <ExpectationField
            label="当前月薪"
            value={meta?.currentSalary ? `¥ ${meta.currentSalary.toLocaleString()}` : null}
          />
          <ExpectationField label="最早入职日" value={meta?.earliestJoiningDate ?? null} />
          <ExpectationField label="备注" value={meta?.notes ?? null} />
        </dl>
      </CardContent>
    </Card>
  );
}

function ExpectationField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 text-foreground text-sm">{value || <EmptyValue />}</dd>
    </div>
  );
}

// ── Offer 单版卡片 ──
// Single offer-version card.

export function OfferCard({
  draft,
  canDelete,
  canUpdate,
  candidateId,
  disabled,
  onRespond,
  onSaved,
  onCancelled,
  onDeleted,
}: {
  draft: OfferDraftRecord;
  canDelete: boolean;
  canUpdate: boolean;
  candidateId: string;
  disabled?: boolean;
  onRespond: () => void;
  onSaved: () => void;
  onCancelled: () => void;
  onDeleted: () => void;
}) {
  const slug = useWorkspaceSlug();
  const meta = getOfferDraftStatusMeta(draft.status);
  const [editing, setEditing] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [newAttachment, setNewAttachment] = useState<File | null>(null);
  const [newAttachmentPreviewUrl, setNewAttachmentPreviewUrl] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<OfferFormState>(() => offerFormStateFromDraft(draft));
  const setFormField = createOfferFormFieldSetter(setForm);

  useEffect(() => {
    if (editing) {
      setForm(offerFormStateFromDraft(draft));
    }
  }, [draft, editing]);

  useEffect(() => {
    if (!newAttachment) {
      setNewAttachmentPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(newAttachment);
    setNewAttachmentPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [newAttachment]);

  function clearNewAttachment() {
    setNewAttachment(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  }

  function selectNewAttachment(file: File | null) {
    if (file && (file.size === 0 || file.size > MAX_OFFER_APPROVAL_ATTACHMENT_BYTES)) {
      toast.error(file.size === 0 ? "请选择非空附件。" : "附件不能超过 20 MB。");
      clearNewAttachment();
      return;
    }
    setNewAttachment(file);
  }

  function handleAttachmentPaste(event: ClipboardEvent<HTMLDivElement>) {
    const file = [...event.clipboardData.files].find((item) => item.type.startsWith("image/"));
    if (!file) {
      return;
    }
    event.preventDefault();
    selectNewAttachment(file.name ? file : new File([file], "ssc-review.png", { type: file.type }));
  }

  const cancelMutation = useMutation({
    mutationFn: () => cancelOfferDraft(slug, candidateId, draft.id),
    onError: (e) => toast.error(e instanceof Error ? e.message : "撤回失败"),
    onSuccess: () => {
      toast.success("已撤回 Offer");
      onCancelled();
    },
  });
  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = buildOfferDraftPayload(form);
      return newAttachment || removeAttachment
        ? patchOfferDraftWithAttachment(slug, candidateId, draft.id, payload, newAttachment)
        : patchOfferDraft(slug, candidateId, draft.id, payload);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "保存失败"),
    onSuccess: () => {
      toast.success("已更新草稿");
      setEditing(false);
      clearNewAttachment();
      setRemoveAttachment(false);
      onSaved();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteOfferDraft(slug, candidateId, draft.id),
    onError: (e) => toast.error(e instanceof Error ? e.message : "删除失败"),
    onSuccess: () => {
      toast.success("已删除 Offer");
      setDeleteConfirmOpen(false);
      onDeleted();
    },
  });
  function cancelEditing() {
    setForm(offerFormStateFromDraft(draft));
    clearNewAttachment();
    setRemoveAttachment(false);
    setEditing(false);
  }

  if (editing && canUpdate && draft.status === "draft") {
    return (
      <Card className="gap-0 rounded-lg py-0">
        <CardContent className="p-4" onPaste={handleAttachmentPaste}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">v{draft.version} · 编辑 Offer 草稿</span>
              <Badge variant={meta.tone}>{meta.label}</Badge>
            </div>
          </div>

          <OfferDraftFormFields
            form={form}
            idPrefix={`offer-${draft.id}`}
            onFieldChange={setFormField}
          />

          <div className="mt-3 grid gap-1.5">
            <Label className="text-sm" htmlFor={`offer-${draft.id}-approval-attachment`}>
              SSC 已审核截图 / 附件（可选）
            </Label>
            {draft.approvalAttachment && !removeAttachment && !newAttachment ? (
              <OfferApprovalAttachment
                candidateId={candidateId}
                draft={draft}
                inline
                onDelete={() => setRemoveAttachment(true)}
                disabled={saveMutation.isPending}
                slug={slug}
              />
            ) : null}
            <Input
              id={`offer-${draft.id}-approval-attachment`}
              onChange={(event) => selectNewAttachment(event.target.files?.[0] ?? null)}
              ref={attachmentInputRef}
              type="file"
            />
            <p className="text-muted-foreground text-xs">
              支持图片、文档、压缩包等文件，也可直接粘贴截图；最大 20 MB。
            </p>
            {newAttachment ? (
              <OfferAttachmentPreview
                filename={newAttachment.name}
                url={newAttachmentPreviewUrl ?? ""}
                imageUrl={
                  /^image\/(avif|bmp|gif|jpeg|png|webp)$/.test(newAttachment.type)
                    ? newAttachmentPreviewUrl
                    : null
                }
                imageAlt={`待上传附件预览：${newAttachment.name}`}
                label="已选择："
                deleteLabel={`移除附件 ${newAttachment.name}`}
                disabled={saveMutation.isPending}
                onDelete={clearNewAttachment}
              />
            ) : null}
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <Button
              disabled={saveMutation.isPending}
              onClick={cancelEditing}
              size="sm"
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={saveMutation.isPending || !form.position.trim() || !form.baseSalary}
              onClick={() => saveMutation.mutate()}
              size="sm"
            >
              {saveMutation.isPending ? "保存中…" : "保存"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-0 rounded-lg py-0">
      <CardContent className="p-4">
        <div className="space-y-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium text-sm">
              v{draft.version} · {draft.position}
            </span>
            <Badge variant={meta.tone}>{meta.label}</Badge>
            {draft.approvalAttachment ? (
              <OfferApprovalAttachment candidateId={candidateId} draft={draft} slug={slug} />
            ) : null}
          </div>

          <OfferDraftReadonlyFields draft={draft} />

          {disabled ? null : (
            <div className="border-border/60 border-t pt-3">
              <OfferCardActions
                canDelete={canDelete}
                canUpdate={canUpdate}
                cancelMutation={cancelMutation}
                draft={draft}
                onEdit={() => setEditing(true)}
                onDelete={() => setDeleteConfirmOpen(true)}
                onRespond={onRespond}
              />
            </div>
          )}
        </div>
        <EntityDeleteDialog
          confirmDisabled={deleteMutation.isPending}
          confirmLabel={deleteMutation.isPending ? "删除中…" : "删除"}
          description={`删除后，Offer v${draft.version} 将不再显示，但历史记录仍会保留。`}
          onClose={() => setDeleteConfirmOpen(false)}
          onConfirm={() => deleteMutation.mutate()}
          record={deleteConfirmOpen ? draft : null}
          title="删除这条 Offer？"
        />
      </CardContent>
    </Card>
  );
}

function OfferApprovalAttachment({
  candidateId,
  draft,
  inline = false,
  onDelete,
  disabled,
  slug,
}: {
  candidateId: string;
  draft: OfferDraftRecord;
  inline?: boolean;
  onDelete?: () => void;
  disabled?: boolean;
  slug: string;
}) {
  const attachment = draft.approvalAttachment;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState<{
    objectUrl: string;
    requestUrl: string;
  } | null>(null);
  const [imageError, setImageError] = useState(false);
  const url = offerApprovalAttachmentUrl(slug, candidateId, draft.id);
  const previewUrl = imagePreview?.requestUrl === url ? imagePreview.objectUrl : null;

  useEffect(() => {
    if (!(previewOpen && attachment?.mediaType.startsWith("image/"))) {
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setImagePreview(null);
    setImageError(false);

    async function loadPreview() {
      try {
        // In dev, image-destination requests bypass the Hono API; fetch reaches the same URL.
        const response = await fetch(url, { credentials: "include", signal: controller.signal });
        if (!response.ok) {
          throw new Error(`附件预览加载失败：${response.status}`);
        }
        const blob = await response.blob();
        if (controller.signal.aborted) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setImagePreview({ objectUrl, requestUrl: url });
      } catch {
        if (!controller.signal.aborted) {
          setImageError(true);
        }
      }
    }

    void loadPreview();
    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [attachment?.mediaType, previewOpen, url]);

  if (!attachment) {
    return null;
  }

  let previewMessage: string | undefined;
  if (attachment.mediaType.startsWith("image/") && (!previewUrl || imageError)) {
    previewMessage = imageError ? "图片加载失败，请关闭弹窗后重试或下载查看。" : "图片加载中…";
  }
  return (
    <OfferAttachmentPreview
      compact={!inline}
      filename={attachment.filename}
      url={url}
      imageUrl={imageError ? null : previewUrl}
      imageAlt={`SSC 审核附件：${attachment.filename}`}
      label="当前附件："
      deleteLabel={`删除审核附件：${attachment.filename}`}
      disabled={disabled}
      onDelete={onDelete}
      onPreviewOpenChange={setPreviewOpen}
      onImageError={() => setImageError(true)}
      previewMessage={previewMessage}
    />
  );
}

function OfferCardActions({
  draft,
  canDelete,
  canUpdate,
  onEdit,
  onDelete,
  onRespond,
  cancelMutation,
}: {
  draft: OfferDraftRecord;
  canDelete: boolean;
  canUpdate: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRespond: () => void;
  cancelMutation: { mutate: () => void; isPending: boolean };
}) {
  if (draft.status === "draft") {
    if (!(canUpdate || canDelete)) {
      return null;
    }
    // Send is intentionally hidden for now — drafts stay editable until a later send path ships.
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {canDelete ? (
          <Button onClick={onDelete} size="sm" variant="ghost">
            <IconTrash className="size-4" />
            删除
          </Button>
        ) : null}
        {canUpdate ? (
          <Button onClick={onEdit} size="sm" variant="ghost">
            <IconPencil className="size-4" />
            编辑
          </Button>
        ) : null}
      </div>
    );
  }
  if (draft.status === "sent") {
    const hasActions = canUpdate || canDelete;
    if (!hasActions) {
      return null;
    }
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {canUpdate ? (
          <Button onClick={onRespond} size="sm">
            <IconCircleCheck className="size-4" />
            记录响应
          </Button>
        ) : null}
        {canDelete ? (
          <Button onClick={onDelete} size="sm" variant="ghost">
            <IconTrash className="size-4" />
            删除
          </Button>
        ) : null}
        {canDelete ? (
          <Button
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
            size="sm"
            variant="outline"
          >
            <IconBan className="size-4" />
            撤回
          </Button>
        ) : null}
      </div>
    );
  }
  return canDelete ? (
    <div className="flex flex-wrap justify-end gap-2">
      <Button onClick={onDelete} size="sm" variant="ghost">
        <IconTrash className="size-4" />
        删除
      </Button>
    </div>
  ) : null;
}

function OfferDraftReadonlyFields({ draft }: { draft: OfferDraftRecord }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm lg:grid-cols-4">
      <ReadonlyOfferField label="职位" value={draft.position} />
      <ReadonlyOfferField label="Base 月薪" value={`¥ ${draft.baseSalary.toLocaleString()}`} />
      <ReadonlyOfferField
        label="年度奖金"
        value={draft.bonus === null ? null : `¥ ${draft.bonus.toLocaleString()}`}
      />
      <ReadonlyOfferField label="期权 / 股票" value={draft.equity} />
      <ReadonlyOfferField
        label="预计入职日"
        value={draft.joiningDate ? formatIsoDateOnly(draft.joiningDate) : null}
      />
      <ReadonlyOfferField
        label="Offer 有效期至"
        value={draft.expiresAt ? formatIsoDateOnly(draft.expiresAt) : null}
      />
      {draft.sentAt ? <ReadonlyOfferField label="发送于" value={formatDate(draft.sentAt)} /> : null}
      {draft.candidateCounter ? (
        <ReadonlyOfferField
          className="col-span-2 lg:col-span-4"
          label="候选人议价"
          value={draft.candidateCounter}
        />
      ) : null}
      <ReadonlyOfferField className="col-span-2 lg:col-span-4" label="备注" value={draft.notes} />
    </dl>
  );
}

function ReadonlyOfferField({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string | null;
}) {
  return (
    <div className={`min-w-0 ${className ?? ""}`}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-0.5 wrap-break-word text-foreground text-sm">{value || <EmptyValue />}</dd>
    </div>
  );
}

export function SendOfferConfirmDialog({
  candidateEmail,
  isPending,
  onConfirm,
  onOpenChange,
  open,
}: {
  candidateEmail: string | null;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const email = candidateEmail?.trim() || "";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>确认发送 Offer</DialogTitle>
          <DialogDescription>
            发送前请确认候选人邮箱。确认后该 Offer 会进入「已发送」状态。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <IconMail className="size-3.5" />
            即将发送至
          </div>
          <div className="mt-1 font-medium text-sm">
            {email || <span className="text-muted-foreground">未填写候选人邮箱</span>}
          </div>
        </div>

        <DialogFooter>
          <Button disabled={isPending} onClick={() => onOpenChange(false)} variant="outline">
            取消
          </Button>
          <Button disabled={isPending || !email} onClick={onConfirm}>
            {isPending ? "发送中…" : "确认发送"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
