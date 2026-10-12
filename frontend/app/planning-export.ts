import { gap, PERIOD_DATES, planned, type PlanRow } from "./table-workspace";
import type { Simulation } from "./planning-simulation";

type Cell = string | number;
const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[character]!);

function column(index: number): string {
  let name = "";
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}

function worksheet(data: Cell[][], frozenColumns = 0): string {
  const rows = data.map((values, rowIndex) => `<row r="${rowIndex + 1}">${values.map((value, columnIndex) => {
    const reference = `${column(columnIndex)}${rowIndex + 1}`;
    const style = rowIndex === 0 ? ' s="1"' : "";
    return typeof value === "number"
      ? `<c r="${reference}"${style}><v>${value}</v></c>`
      : `<c r="${reference}" t="inlineStr"${style}><is><t>${escapeXml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const pane = frozenColumns ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${frozenColumns}" ySplit="1" topLeftCell="${column(frozenColumns)}2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<sheetFormatPr defaultRowHeight="18"/><sheetData>${rows}</sheetData></worksheet>`;
}

function crc32(data: Uint8Array): number {
  let crc = -1;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

function zip(files: Record<string, string>): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (view: DataView, position: number, value: number) => view.setUint16(position, value, true);
  const u32 = (view: DataView, position: number, value: number) => view.setUint32(position, value, true);
  for (const [path, xml] of Object.entries(files)) {
    const name = encoder.encode(path);
    const body = encoder.encode(xml);
    const checksum = crc32(body);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    u32(localView, 0, 0x04034b50); u16(localView, 4, 20); u16(localView, 6, 0x800);
    u32(localView, 14, checksum); u32(localView, 18, body.length); u32(localView, 22, body.length);
    u16(localView, 26, name.length); local.set(name, 30);
    parts.push(local, body);
    const entry = new Uint8Array(46 + name.length);
    const view = new DataView(entry.buffer);
    u32(view, 0, 0x02014b50); u16(view, 4, 20); u16(view, 6, 20); u16(view, 8, 0x800);
    u32(view, 16, checksum); u32(view, 20, body.length); u32(view, 24, body.length);
    u16(view, 28, name.length); u32(view, 42, offset); entry.set(name, 46);
    central.push(entry);
    offset += local.length + body.length;
  }
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  u32(view, 0, 0x06054b50); u16(view, 8, central.length); u16(view, 10, central.length);
  u32(view, 12, centralSize); u32(view, 16, offset);
  return new Blob([...parts, ...central, end].map((part) => part as BlobPart), { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadPlanExcel(rows: PlanRow[], version: string, simulation: Simulation | null): void {
  const dates = [...PERIOD_DATES.M1, ...PERIOD_DATES.M2];
  const header: Cell[] = ["加工地 Site", "产品型号", "配置", "用途", "电池盖颜色", "中框颜色", "PSpart(S)", "Ppart(M)", "P_DPS对象", "供应模式", "P_DPS开始日", "P_DPS M1截止日", "P_DPS M2截止日", "M1锁定期外在制", "M2锁定期外在制", "M1 S&OP", "M1 预排", "M1 GAP", "M2 S&OP", "M2 预排", "M2 GAP", "产能共用组", ...dates];
  const detail: Cell[][] = [header, ...rows.map((row) => [row.site, row.model, row.config, row.purpose, row.batteryCover, row.frameColor, row.psPart, row.pPart, row.dpsObject, row.supplyMode, row.startDate, row.deadlines.M1, row.deadlines.M2, row.wip.M1, row.wip.M2, row.sop.M1, planned(row, "M1"), gap(row, "M1"), row.sop.M2, planned(row, "M2"), gap(row, "M2"), row.capacityGroup, ...dates.map((date) => row.daily[date <= PERIOD_DATES.M1.at(-1)! ? "M1" : "M2"][date])])];
  const info: Cell[][] = [["字段", "内容"], ["发布版本", version], ["生成时间", new Date().toLocaleString("zh-CN")], ["数据类型", "演示数据"], ["GAP 口径", "S&OP - 预排 - 锁定期外在制"], ["重算口径", simulation ? "演示分摊规则；尚未接入真实 DPS 排产引擎" : "基础版本"], ["模拟说明", simulation?.note ?? ""], ["输入变更数", simulation?.changes.length ?? 0]];
  const files = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="排产结果" sheetId="1" r:id="rId1"/><sheet name="版本说明" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF315E42"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": worksheet(detail, 3),
    "xl/worksheets/sheet2.xml": worksheet(info),
  };
  const href = URL.createObjectURL(zip(files));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `DPS_排产结果_${version}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
