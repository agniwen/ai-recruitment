import { describe, expect, it, vi } from "vitest";
import { downloadSscResponsibilityTemplate } from "./download-template";
import { parseSscResponsibilityRows } from "./import-file";

const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("../data-export/xlsx-export", () => ({ downloadDataExportXlsx: mocks.download }));

describe("SSC responsibility scope template", () => {
  it("exports distinct scope columns that round trip through the import field mapping", async () => {
    await downloadSscResponsibilityTemplate();
    const config = mocks.download.mock.calls[0]?.[0] as
      | { columns: { id: string; label: string }[] }
      | undefined;
    if (!config) {
      throw new Error("Template download was not requested");
    }
    const labels = config.columns.map((column) => column.label);
    expect(labels.slice(1, 4)).toEqual(["中心/部门", "服务单位", "部门"]);
    const values: Record<string, string> = {
      centerName: "渠道中心",
      departmentName: "创意部",
      serviceUnit: "智能增长事业部",
    };
    expect(
      parseSscResponsibilityRows([
        labels,
        config.columns.map((column) => values[column.id] ?? ""),
      ])[0],
    ).toMatchObject({
      centerName: "渠道中心",
      departmentName: "创意部",
      serviceUnit: "智能增长事业部",
    });
  });
});
