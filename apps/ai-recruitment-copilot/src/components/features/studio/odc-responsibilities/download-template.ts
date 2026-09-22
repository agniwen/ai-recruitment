import { downloadDataExportXlsx } from "../data-export/xlsx-export";

export function downloadResponsibilityTemplate() {
  return downloadDataExportXlsx({
    columns: [
      { id: "type", label: "人员类型", value: () => "", width: 16 },
      { id: "name", label: "姓名/花名", value: () => "", width: 18 },
      { id: "center", label: "负责公司/团队/部门", value: () => "", width: 28 },
      { id: "departments", label: "负责部门/小组", value: () => "", width: 45 },
      { id: "email", label: "邮箱", value: () => "", width: 36 },
      { id: "telegram", label: "TG", value: () => "", width: 24 },
    ],
    fileName: "ODC负责范围模板",
    rows: [],
    sheetName: "ODC负责范围",
  });
}
