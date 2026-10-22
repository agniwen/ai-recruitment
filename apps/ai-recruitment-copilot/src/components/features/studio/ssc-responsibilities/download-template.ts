import { downloadDataExportXlsx } from "../data-export/xlsx-export";

export function downloadSscResponsibilityTemplate() {
  return downloadDataExportXlsx({
    columns: [
      { id: "demandOwner", label: "需求对接负责人", value: () => "", width: 22 },
      { id: "centerName", label: "中心/部门", value: () => "", width: 28 },
      { id: "serviceUnit", label: "服务单位", value: () => "", width: 28 },
      { id: "departmentName", label: "部门", value: () => "", width: 28 },
      { id: "sscName", label: "SSC 花名", value: () => "", width: 18 },
      { id: "telegram", label: "SSC TG", value: () => "", width: 24 },
      { id: "email", label: "SSC 邮箱", value: () => "", width: 36 },
      { id: "notes", label: "备注", value: () => "", width: 40 },
    ],
    fileName: "SSC负责组织导入模板",
    rows: [],
    sheetName: "SSC负责组织",
  });
}
