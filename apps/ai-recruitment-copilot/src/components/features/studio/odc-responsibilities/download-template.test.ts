import { expect, it, vi } from "vitest";
import { downloadResponsibilityTemplate } from "./download-template";

const mocks = vi.hoisted(() => ({ download: vi.fn().mockResolvedValue(null) }));
vi.mock("../data-export/xlsx-export", () => ({ downloadDataExportXlsx: mocks.download }));

it("downloads an XLSX template with screenshot-compatible columns", async () => {
  await downloadResponsibilityTemplate();
  expect(mocks.download).toHaveBeenCalledWith({
    columns: ["人员类型", "姓名/花名", "负责公司/团队/部门", "负责部门/小组", "邮箱", "TG"].map(
      (label) => expect.objectContaining({ label }),
    ),
    fileName: "ODC负责范围模板",
    rows: [],
    sheetName: "ODC负责范围",
  });
});
