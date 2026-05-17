import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const vspherePath = "C:/Users/vaisman/Desktop/vsphere-vm-power-state.csv";
const veeamPath = "C:/Users/vaisman/Desktop/veeam-restore-points.csv";
const outputDir = "C:/Users/vaisman/Desktop";
const outputPath = path.join(outputDir, "poweredoff-servers-veeam-marked.xlsx");

function parseBrokenCsvLine(line) {
  let s = line.trimEnd();
  if (s.startsWith('"')) {
    s = s.slice(1);
  }
  if (s.endsWith('"')) {
    s = s.slice(0, -1);
  }
  s = s.replaceAll('""', '"');

  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

async function importBrokenCsv(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const headers = parseBrokenCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseBrokenCsvLine(line);
    return Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
  });
}

function normalizeName(name) {
  return (name ?? "").trim().toLowerCase();
}

function parseVeeamDate(value) {
  const match = String(value ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, min, ss] = match;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
}

const vsphereRows = await importBrokenCsv(vspherePath);
const veeamRows = await importBrokenCsv(veeamPath);

const veeamByVm = new Map();
for (const row of veeamRows) {
  const vmName = row.VMName?.trim();
  if (!vmName) continue;
  const key = normalizeName(vmName);
  const created = parseVeeamDate(row.CreationTime);
  if (!veeamByVm.has(key)) {
    veeamByVm.set(key, {
      vmName,
      backupNames: new Set(),
      restorePointCount: 0,
      lastRestorePoint: null,
      lastRestorePointText: "",
    });
  }
  const item = veeamByVm.get(key);
  item.backupNames.add(row.BackupName ?? "");
  item.restorePointCount += 1;
  if (created && (!item.lastRestorePoint || created > item.lastRestorePoint)) {
    item.lastRestorePoint = created;
    item.lastRestorePointText = row.CreationTime;
  }
}

const reportRows = vsphereRows
  .filter((row) => row.PowerState === "PoweredOff")
  .filter((row) => !normalizeName(row.Name).endsWith("_replica"))
  .map((row) => {
    const vmName = row.Name.trim();
    const veeam = veeamByVm.get(normalizeName(vmName));
    return {
      vmName,
      powerState: row.PowerState,
      veeamBackup: veeam ? "Yes" : "",
      backupNames: veeam ? Array.from(veeam.backupNames).filter(Boolean).sort().join("; ") : "",
      lastRestorePoint: veeam ? veeam.lastRestorePointText : "",
      restorePointCount: veeam ? veeam.restorePointCount : "",
    };
  })
  .sort((a, b) => a.vmName.localeCompare(b.vmName, "en", { sensitivity: "base" }));

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("PoweredOff Servers");
sheet.showGridLines = false;

const headers = [
  "Server",
  "Power State",
  "Veeam Backup",
  "Backup Job(s)",
  "Last Restore Point",
  "Restore Points",
];
const values = [
  headers,
  ...reportRows.map((row) => [
    row.vmName,
    row.powerState,
    row.veeamBackup,
    row.backupNames,
    row.lastRestorePoint,
    row.restorePointCount,
  ]),
];

sheet.getRangeByIndexes(0, 0, values.length, headers.length).values = values;
sheet.freezePanes.freezeRows(1);

const used = sheet.getRangeByIndexes(0, 0, values.length, headers.length);
used.format.font = { name: "Calibri", size: 11, color: "#111827" };
used.format.borders = {
  insideHorizontal: { style: "continuous", color: "#E5E7EB", weight: "thin" },
  insideVertical: { style: "continuous", color: "#E5E7EB", weight: "thin" },
  edgeBottom: { style: "continuous", color: "#D1D5DB", weight: "thin" },
};

const headerRange = sheet.getRangeByIndexes(0, 0, 1, headers.length);
headerRange.format.fill = "#1F2937";
headerRange.format.font = { bold: true, color: "#FFFFFF" };
headerRange.format.rowHeightPx = 28;

sheet.getRangeByIndexes(0, 0, values.length, 1).format.columnWidthPx = 330;
sheet.getRangeByIndexes(0, 1, values.length, 1).format.columnWidthPx = 105;
sheet.getRangeByIndexes(0, 2, values.length, 1).format.columnWidthPx = 105;
sheet.getRangeByIndexes(0, 3, values.length, 1).format.columnWidthPx = 240;
sheet.getRangeByIndexes(0, 4, values.length, 1).format.columnWidthPx = 145;
sheet.getRangeByIndexes(0, 5, values.length, 1).format.columnWidthPx = 105;
sheet.getRangeByIndexes(0, 3, values.length, 1).format.wrapText = true;

const pink = "#F8BBD0";
for (let i = 0; i < reportRows.length; i++) {
  if (reportRows[i].veeamBackup === "Yes") {
    sheet.getCell(i + 1, 0).format.fill = pink;
    sheet.getCell(i + 1, 2).format.fill = pink;
  }
}

sheet.tables.add(`A1:F${values.length}`, true, "PoweredOffServers");

const summary = workbook.worksheets.add("Summary");
summary.showGridLines = false;
const backedUp = reportRows.filter((row) => row.veeamBackup === "Yes").length;
const summaryValues = [
  ["Metric", "Count"],
  ["Powered off servers excluding replicas", reportRows.length],
  ["Marked pink - found in Veeam", backedUp],
  ["Not marked - not found in Veeam", reportRows.length - backedUp],
];
summary.getRange("A1:B4").values = summaryValues;
summary.getRange("A1:B1").format.fill = "#1F2937";
summary.getRange("A1:B1").format.font = { bold: true, color: "#FFFFFF" };
summary.getRange("A1:A4").format.columnWidthPx = 260;
summary.getRange("B1:B4").format.columnWidthPx = 90;
summary.tables.add("A1:B4", true, "SummaryTable");

const inspect = await workbook.inspect({
  kind: "table",
  range: "PoweredOff Servers!A1:F20",
  include: "values",
  tableMaxRows: 20,
  tableMaxCols: 6,
});
console.log(inspect.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "formula error scan",
});
console.log(errors.ndjson);

await workbook.render({ sheetName: "PoweredOff Servers", range: "A1:F30", scale: 1 });
await workbook.render({ sheetName: "Summary", range: "A1:B4", scale: 1 });

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(JSON.stringify({
  outputPath,
  totalPoweredOffNonReplicas: reportRows.length,
  veeamMarkedPink: backedUp,
  notFoundInVeeam: reportRows.length - backedUp,
}));
