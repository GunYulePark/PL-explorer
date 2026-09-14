import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

const siteOrigin = "https://gunyulepark.github.io";
const templateUrl = "https://raw.githubusercontent.com/GunYulePark/PL-explorer/main/assets/pnl-export-template.xlsx";
const statementCodes = ["sales", "cogs", "gross_profit", "sga", "rnd", "operating_profit"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const corsHeaders = {
  "Access-Control-Allow-Origin": siteOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin",
};

type ExportRequest = { years?: number[]; year_from?: number | null; year_to?: number | null; products?: string[]; brands?: string[]; customers?: string[]; sites?: string[]; layout?: { rows?: string[]; columns?: string[]; measures?: string[] } };
type Fact = { fiscal_year: number | null; fiscal_quarter: string | null; product_name: string | null; brand: string | null; customer_group_name: string | null; site_name: string | null; account_code: string; amount: number | string };

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }); }
function escapeXml(value: unknown) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
function columnName(column: number) { let name = ""; for (let current = column; current > 0; current = Math.floor((current - 1) / 26)) name = String.fromCharCode(65 + ((current - 1) % 26)) + name; return name; }
function rawSheetXml(rows: Fact[], names: Map<string, string>) {
  const headers = ["fiscal_year", "fiscal_quarter", "product_name", "brand", "customer_group_name", "site_name", "account_code", "account_name", "amount"];
  const records = [headers, ...rows.map((fact) => [fact.fiscal_year, fact.fiscal_quarter, fact.product_name, fact.brand, fact.customer_group_name, fact.site_name, fact.account_code, names.get(fact.account_code) ?? fact.account_code, fact.amount])];
  const body = records.map((values, rowIndex) => `<row r="${rowIndex + 1}" spans="1:9">${values.map((value, index) => {
    const cell = `${columnName(index + 1)}${rowIndex + 1}`;
    return rowIndex > 0 && (index === 0 || index === 8) && value !== null && value !== "" ? `<c r="${cell}"><v>${escapeXml(value)}</v></c>` : `<c r="${cell}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:I${records.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="17.4"/><cols><col min="1" max="1" width="12" customWidth="1"/><col min="2" max="2" width="13" customWidth="1"/><col min="3" max="6" width="22" customWidth="1"/><col min="7" max="8" width="18" customWidth="1"/><col min="9" max="9" width="16" customWidth="1"/></cols><sheetData>${body}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`;
}
type SummaryField = { key: "period" | "product_name" | "brand" | "customer_group_name" | "site_name" | "account_name"; label: string };
const layoutField: Record<string, SummaryField[]> = {
  "기간": [{ key: "period", label: "기간" }], "제품": [{ key: "product_name", label: "제품" }], "브랜드": [{ key: "brand", label: "브랜드" }],
  "고객구분": [{ key: "customer_group_name", label: "고객구분" }], "사업장": [{ key: "site_name", label: "사업장" }], "손익 항목": [{ key: "account_name", label: "손익 항목" }], "측정치": [{ key: "account_name", label: "측정치" }],
};
function summaryFields(labels: string[] | undefined) { return (labels ?? []).flatMap((label) => layoutField[label] ?? []).filter((field, index, fields) => fields.findIndex((item) => item.key === field.key) === index); }
function summaryValue(fact: Fact, names: Map<string, string>, key: SummaryField["key"]) {
  if (key === "period") return fact.fiscal_year ? `${fact.fiscal_year}${fact.fiscal_quarter ? ` ${fact.fiscal_quarter}` : ""}` : "미지정";
  if (key === "account_name") return names.get(fact.account_code) ?? fact.account_code;
  return fact[key] || "미지정";
}
function selectedFilterSummary(request: ExportRequest) {
  const parts: string[] = [];
  if (request.years?.length) parts.push(`개별 연도 ${request.years.join(", ")}`);
  else if (request.year_from || request.year_to) parts.push(`기간 ${request.year_from ?? "처음"}~${request.year_to ?? "끝"}`);
  for (const [label, values] of [["제품", request.products], ["브랜드", request.brands], ["고객구분", request.customers], ["사업장", request.sites]] as const) {
    if (values?.length) parts.push(`${label} ${values.join(", ")}`);
  }
  return parts.length ? parts.join(" / ") : "추가 필터 없음";
}
type SummaryRow = { values: unknown[]; numericColumns: Set<number> };
function summarySheetDocument(request: ExportRequest, headers: string[], data: SummaryRow[], rowBasis: string, columnBasis: string, aggregation: string) {
  const cell = (reference: string, value: unknown, numeric = false) => numeric ? `<c r="${reference}"><v>${escapeXml(value)}</v></c>` : `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  const title = "P/L Explorer 요약";
  const headerRow = 7;
  const headerCells = headers.map((value, index) => cell(`${columnName(index + 1)}${headerRow}`, value)).join("");
  const body = data.map((row, index) => { const rowNumber = index + headerRow + 1; return `<row r="${rowNumber}">${row.values.map((value, column) => cell(`${columnName(column + 1)}${rowNumber}`, value ?? "", row.numericColumns.has(column))).join("")}</row>`; }).join("");
  const lastColumn = columnName(headers.length); const lastRow = Math.max(headerRow, data.length + headerRow);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="17.4"/><cols>${headers.map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="22" customWidth="1"/>`).join("")}</cols><sheetData><row r="1">${cell("A1", title)}</row><row r="2">${cell("A2", aggregation)}</row><row r="3">${cell("A3", `행 그룹: ${rowBasis}`)}</row><row r="4">${cell("A4", `열 그룹: ${columnBasis}`)}</row><row r="5">${cell("A5", `적용 필터: ${selectedFilterSummary(request)}`)}</row><row r="${headerRow}">${headerCells}</row>${body}</sheetData><autoFilter ref="A${headerRow}:${lastColumn}${lastRow}"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}
function summarySheetXml(facts: Fact[], names: Map<string, string>, request: ExportRequest) {
  const layout = request.layout;
  const rowFields = summaryFields(layout?.rows).filter((field) => field.key !== "account_name");
  if (layout?.columns?.includes("측정치")) {
    const measureCodes = (layout.measures?.filter((code) => statementCodes.includes(code)) ?? statementCodes);
    const activeMeasures = measureCodes.length ? measureCodes : statementCodes;
    const fields = rowFields.length ? rowFields : [{ key: "period" as const, label: "기간" }];
    const totals = new Map<string, { values: string[]; amounts: Map<string, number> }>();
    facts.forEach((fact) => {
      const values = fields.map((field) => summaryValue(fact, names, field.key)); const key = values.join("\u0001");
      const current = totals.get(key) ?? { values, amounts: new Map<string, number>() };
      current.amounts.set(fact.account_code, (current.amounts.get(fact.account_code) ?? 0) + Number(fact.amount)); totals.set(key, current);
    });
    const data = [...totals.values()].sort((left, right) => left.values.join("\u0001").localeCompare(right.values.join("\u0001"), "ko")).map((row) => ({
      values: [...row.values, ...activeMeasures.map((code) => row.amounts.get(code) ?? null)],
      numericColumns: new Set(activeMeasures.flatMap((code, index) => row.amounts.has(code) ? [fields.length + index] : [])),
    }));
    return summarySheetDocument(request, [...fields.map((field) => field.label), ...activeMeasures.map((code) => names.get(code) ?? code)], data, fields.map((field) => field.label).join(" > "), "측정치", "합계 기준: 필터 적용 후 RAW 시트의 amount를 합산하며, 각 손익 항목은 별도 열에 표시합니다.");
  }
  const columnFields = summaryFields(layout?.columns).filter((field) => !rowFields.some((row) => row.key === field.key));
  const fields = [...(rowFields.length ? rowFields : [{ key: "account_name" as const, label: "손익 항목" }]), ...(columnFields.length ? columnFields : [{ key: "period" as const, label: "기간" }])];
  const totals = new Map<string, { values: string[]; amount: number }>();
  facts.forEach((fact) => { const values = fields.map((field) => summaryValue(fact, names, field.key)); const key = values.join("\u0001"); const current = totals.get(key) ?? { values, amount: 0 }; current.amount += Number(fact.amount); totals.set(key, current); });
  const data = [...totals.values()].sort((left, right) => left.values.join("\u0001").localeCompare(right.values.join("\u0001"), "ko")).map((row) => ({ values: [...row.values, row.amount], numericColumns: new Set([fields.length]) }));
  return summarySheetDocument(request, [...fields.map((field) => field.label), "금액"], data, (rowFields.length ? rowFields : [{ label: "손익 항목" }]).map((field) => field.label).join(" > "), (columnFields.length ? columnFields : [{ label: "기간" }]).map((field) => field.label).join(" > "), "합계 기준: 필터 적용 후 RAW 시트의 amount를 합산하며, 같은 행·열 기준 조합은 한 행으로 집계합니다.");
}
async function filteredFacts(admin: ReturnType<typeof createClient>, batchId: string, request: ExportRequest) {
  const facts: Fact[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = admin.from("pl_facts").select("fiscal_year,fiscal_quarter,product_name,brand,customer_group_name,site_name,account_code,amount").eq("import_batch_id", batchId).in("account_code", statementCodes).order("source_row_number").order("account_code").range(offset, offset + 999);
    if (request.years?.length) query = query.in("fiscal_year", request.years);
    else { if (request.year_from) query = query.gte("fiscal_year", request.year_from); if (request.year_to) query = query.lte("fiscal_year", request.year_to); }
    if (request.products?.length) query = query.in("product_name", request.products);
    if (request.brands?.length) query = query.in("brand", request.brands);
    if (request.customers?.length) query = query.in("customer_group_name", request.customers);
    if (request.sites?.length) query = query.in("site_name", request.sites);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    facts.push(...(data as Fact[] ?? []));
    if (!data || data.length < 1000) return facts;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST" || request.headers.get("origin") !== siteOrigin) return json({ error: "허용되지 않은 요청입니다." }, 403);
  const jobId = new URL(request.url).searchParams.get("job") ?? "";
  if (!uuid.test(jobId)) return json({ error: "유효하지 않은 내보내기 요청입니다." }, 400);
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); const serviceKey = keys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !supabaseUrl) return json({ error: "서버 설정이 완료되지 않았습니다." }, 500);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: job, error: jobError } = await admin.from("pivot_export_jobs").select("id,import_batch_id,request,status").eq("id", jobId).maybeSingle();
  if (jobError || !job) return json({ error: "내보내기 요청을 찾을 수 없습니다." }, 404);
  if (job.status === "completed") return json({ status: "completed" });
  const { data: claimed } = await admin.from("pivot_export_jobs").update({ status: "processing", error_message: null }).eq("id", jobId).eq("status", "queued").select("id");
  if (!claimed?.length) return json({ status: job.status }, 202);
  try {
    const [facts, accounts, templateResponse] = await Promise.all([
      filteredFacts(admin, job.import_batch_id, (job.request ?? {}) as ExportRequest),
      admin.from("pl_accounts").select("account_code,account_name"),
      fetch(templateUrl, { headers: { "Cache-Control": "no-cache" } }),
    ]);
    if (!templateResponse.ok) throw new Error("Excel 템플릿을 불러오지 못했습니다.");
    const names = new Map((accounts.data ?? []).map((account) => [account.account_code, account.account_name]));
    const zip = await JSZip.loadAsync(await templateResponse.arrayBuffer());
    zip.file("xl/worksheets/sheet2.xml", rawSheetXml(facts, names));
    zip.file("xl/worksheets/sheet1.xml", summarySheetXml(facts, names, (job.request ?? {}) as ExportRequest));
    const table = await zip.file("xl/tables/table1.xml")?.async("string");
    if (!table) throw new Error("Excel 템플릿 구성이 올바르지 않습니다.");
    const lastRow = facts.length + 1;
    zip.file("xl/tables/table1.xml", table.replaceAll(/ref="A1:I\d+"/g, `ref="A1:I${lastRow}"`));
    const output = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const storagePath = `pivot/${jobId}.xlsx`; const filename = `P_L_Explorer_Export_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}.xlsx`;
    const { error: uploadError } = await admin.storage.from("pnl-exports").upload(storagePath, new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), { upsert: true, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (uploadError) throw new Error(uploadError.message);
    const { error: updateError } = await admin.from("pivot_export_jobs").update({ status: "completed", processed_at: new Date().toISOString(), result_storage_path: storagePath, result_filename: filename }).eq("id", jobId);
    if (updateError) throw new Error(updateError.message);
    return json({ status: "completed", rows: facts.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    await admin.from("pivot_export_jobs").update({ status: "failed", processed_at: new Date().toISOString(), error_message: message.slice(0, 1000) }).eq("id", jobId);
    return json({ error: message }, 500);
  }
});
