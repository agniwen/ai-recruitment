import { eq } from "drizzle-orm";
import type { db } from "@arc/ai-recruitment-copilot-backend/lib/server/db";
import { department, hiringUnit, resumeSource } from "@arc/db-schema/schema";
import type { GoogleSheetJobRecord } from "./google-sheets-sync";

type SyncTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").replaceAll(/\s+/g, " ").trim().toLocaleLowerCase("zh-CN");
}

function childIdentity(parentId: string | null, name: string): string {
  return JSON.stringify([parentId, normalizeIdentity(name)]);
}

/** Only inserts missing hierarchy nodes; existing nodes are never renamed or reparented. */
export async function loadGoogleSheetHierarchy({
  tx,
  actorUserId,
  organizationId,
  now,
}: {
  tx: SyncTransaction;
  actorUserId: string | null | undefined;
  organizationId: string;
  now: Date;
}) {
  const sourceRows = await tx
    .select({ id: resumeSource.id, name: resumeSource.name })
    .from(resumeSource)
    .where(eq(resumeSource.organizationId, organizationId))
    .orderBy(resumeSource.createdAt, resumeSource.id);
  const sourcesByName = new Map<string, { id: string; name: string }>();
  for (const row of sourceRows) {
    const key = normalizeIdentity(row.name);
    if (!sourcesByName.has(key)) {
      sourcesByName.set(key, row);
    }
  }
  const hiringUnitRows = await tx
    .select({
      id: hiringUnit.id,
      name: hiringUnit.name,
      resumeSourceId: hiringUnit.resumeSourceId,
    })
    .from(hiringUnit)
    .where(eq(hiringUnit.organizationId, organizationId))
    .orderBy(hiringUnit.createdAt, hiringUnit.id);
  const hiringUnitsByName = new Map<string, { id: string; name: string }>();
  for (const row of hiringUnitRows) {
    const key = childIdentity(row.resumeSourceId, row.name);
    if (!hiringUnitsByName.has(key)) {
      hiringUnitsByName.set(key, row);
    }
  }

  const departmentRows = await tx
    .select({
      hiringUnitId: department.hiringUnitId,
      id: department.id,
      name: department.name,
    })
    .from(department)
    .where(eq(department.organizationId, organizationId))
    .orderBy(department.createdAt, department.id);
  // Department identity is scoped to its parent, never just its name.
  const departmentParents = new Map(departmentRows.map((row) => [row.id, row.hiringUnitId]));
  const departmentsByName = new Map<string, { id: string; name: string }>();
  for (const row of departmentRows) {
    const key = childIdentity(row.hiringUnitId, row.name);
    if (!departmentsByName.has(key)) {
      departmentsByName.set(key, row);
    }
  }

  const counts = { departmentsCreated: 0, hiringUnitsCreated: 0, resumeSourcesCreated: 0 };
  return {
    counts,
    async resolve(record: GoogleSheetJobRecord, existingDepartmentId?: string) {
      const sourceKey = normalizeIdentity(record.sourceSheet);
      let source = sourcesByName.get(sourceKey);
      if (!source) {
        source = { id: crypto.randomUUID(), name: record.sourceSheet };
        await tx.insert(resumeSource).values({
          ...source,
          createdAt: now,
          createdBy: actorUserId ?? null,
          organizationId,
          updatedAt: now,
        });
        sourcesByName.set(sourceKey, source);
        counts.resumeSourcesCreated += 1;
      }
      const hiringUnitKey = childIdentity(source.id, record.hiringUnitName);
      let unit = hiringUnitsByName.get(hiringUnitKey);
      if (!unit) {
        unit = { id: crypto.randomUUID(), name: record.hiringUnitName };
        await tx.insert(hiringUnit).values({
          createdAt: now,
          createdBy: actorUserId ?? null,
          description: null,
          id: unit.id,
          name: unit.name,
          organizationId,
          resumeSourceId: source.id,
          updatedAt: now,
        });
        hiringUnitsByName.set(hiringUnitKey, unit);
        counts.hiringUnitsCreated += 1;
      }
      const hiringUnitIdForWrite = unit.id;

      // Preserve a local department only if it still belongs to this exact parent.
      // Never move an existing organization/department to satisfy a sheet row.
      const shouldWriteDepartment =
        record.departmentSpecified ||
        !existingDepartmentId ||
        departmentParents.get(existingDepartmentId) !== hiringUnitIdForWrite;
      let departmentIdForWrite: string | undefined;
      if (shouldWriteDepartment) {
        const departmentKey = childIdentity(hiringUnitIdForWrite, record.departmentName);
        let departmentRow = departmentsByName.get(departmentKey);
        if (!departmentRow) {
          departmentRow = { id: crypto.randomUUID(), name: record.departmentName };
          await tx.insert(department).values({
            createdAt: now,
            createdBy: actorUserId ?? null,
            description: null,
            hiringUnitId: hiringUnitIdForWrite,
            id: departmentRow.id,
            name: departmentRow.name,
            organizationId,
            updatedAt: now,
          });
          departmentsByName.set(departmentKey, departmentRow);
          departmentParents.set(departmentRow.id, hiringUnitIdForWrite);
          counts.departmentsCreated += 1;
        }
        departmentIdForWrite = departmentRow.id;
      }

      return {
        departmentId: departmentIdForWrite,
        hiringUnitId: hiringUnitIdForWrite,
        resumeSourceId: source.id,
        sourceName: source.name,
      };
    },
  };
}
