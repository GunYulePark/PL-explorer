"use client";

import { ChangeEvent, DragEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { sampleFilters, sampleStatementRows } from "@/lib/sample-data";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { statementOrder, type StatementCode, type StatementRow } from "@/lib/types";

type Axis = "rows" | "columns";
type DraggedAxisItem = { axis: Axis; item: string };
type FilterState = { dataset: string; yearFrom: string; yearTo: string; selectedYears: string[]; product: string[]; brand: string[]; customer: string[]; site: string[] };
type LayoutConfig = { rows: string[]; columns: string[]; filters: string[] };
type SavedPreset = { id: string; name: string; description: string | null; config: LayoutConfig; isSystem: boolean };
type Dataset = { id: string; name: string };
type FilterOptions = { years: string[]; products: string[]; brands: string[]; customers: string[]; sites: string[] };
type FilterOptionPayload = FilterOptions & { datasets: Dataset[] };
type BreakdownDimension = "product" | "brand" | "customer" | "site";
type MatrixRecord = { dimension_values: Partial<Record<BreakdownDimension, string>>; period_label: string; period_sort: number; account_code: StatementCode; amount: number | string };

const paletteItems = ["측정치", "기간", "제품", "브랜드", "분류", "효능군", "고객구분", "사업장", "대구분", "중구분", "소구분", "국가"];
const initialFieldExamples: Record<string, string[]> = {
  "측정치": ["매출액", "판매비와관리비", "영업이익"],
  "기간": ["Supabase 연결 후 표시", "목록 중간 구간", "목록 75% 구간"],
  "제품": ["Supabase 연결 후 표시", "목록 중간 구간", "목록 75% 구간"],
  "브랜드": ["Supabase 연결 후 표시", "목록 중간 구간", "목록 75% 구간"],
  "분류": ["Supabase 연결 후 표시", "목록 중간 구간", "목록 75% 구간"],
  "효능군": ["Supabase 연결 후 표시", "목록 중간 구간", "목록 75% 구간"],
  "고객구분": ["Supabase 연결 후 표시", "목록 중간 구간", "목록 75% 구간"],
  "사업장": ["Supabase 연결 후 표시", "목록 중간 구간", "목록 75% 구간"],
  "대구분": ["Supabase 연결 후 표시", "목록 중간 구간", "목록 75% 구간"],
  "중구분": ["Supabase 연결 후 표시", "목록 중간 구간", "목록 75% 구간"],
  "소구분": ["Supabase 연결 후 표시", "목록 중간 구간", "목록 75% 구간"],
  "국가": ["Supabase 연결 후 표시", "목록 중간 구간", "목록 75% 구간"],
};
const systemPresets: SavedPreset[] = [
  { id: "system-pnl", name: "기본 손익표", description: "손익 항목을 행으로, 기간을 열로 조회", isSystem: true, config: { rows: ["손익 항목"], columns: ["기간"], filters: ["제품", "브랜드", "고객구분", "사업장"] } },
  { id: "system-product", name: "품목별 분기 손익", description: "제품별 손익을 분기별로 비교", isSystem: true, config: { rows: ["제품", "손익 항목"], columns: ["기간"], filters: ["브랜드", "고객구분", "사업장"] } },
  { id: "system-site", name: "사업장별 수익성", description: "사업장별 매출과 영업이익을 비교", isSystem: true, config: { rows: ["사업장"], columns: ["측정치", "기간"], filters: ["제품", "브랜드", "고객구분"] } },
];
const initialFilters: FilterState = { dataset: "전체", yearFrom: "", yearTo: "", selectedYears: [], product: [], brand: [], customer: [], site: [] };
const breakdownDimensions: Array<{ label: string; value: BreakdownDimension }> = [
  { label: "제품", value: "product" }, { label: "브랜드", value: "brand" },
  { label: "고객구분", value: "customer" }, { label: "사업장", value: "site" },
];
const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

function amount(value: number | null) { return value === null ? "데이터 없음" : money.format(value); }
function csvCell(value: string | number | null) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function spacedExamples(values: Array<string | number | null | undefined>, fallback: string[]) {
  const unique = [...new Set(values.filter((value): value is string | number => value !== null && value !== undefined && String(value).trim() !== "").map(String))].sort((left, right) => left.localeCompare(right, "ko"));
  if (unique.length < 3) return unique.length ? unique : fallback;
  // 앞쪽 값만 보이지 않도록 25% · 50% · 75% 지점의 값을 보여준다.
  return [unique[Math.floor((unique.length - 1) * 0.25)], unique[Math.floor((unique.length - 1) * 0.5)], unique[Math.floor((unique.length - 1) * 0.75)]];
}
function asRows(records: { account_code: StatementCode; amount: number | string }[]): StatementRow[] {
  const totals = new Map<StatementCode, number>();
  records.forEach((record) => totals.set(record.account_code, (totals.get(record.account_code) ?? 0) + Number(record.amount)));
  return statementOrder.map(({ code, label }) => ({ code, label, amount: totals.has(code) ? totals.get(code) ?? null : null }));
}
function ensureConfig(value: unknown): LayoutConfig {
  const config = value as Partial<LayoutConfig> | null;
  return { rows: Array.isArray(config?.rows) ? config.rows : ["손익 항목"], columns: Array.isArray(config?.columns) ? config.columns : ["기간"], filters: Array.isArray(config?.filters) ? config.filters : [] };
}

function PivotFilter({ label, values, selected, onChange }: { label: string; values: string[]; selected: string[]; onChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const visible = values.filter((value) => value.toLocaleLowerCase("ko").includes(search.toLocaleLowerCase("ko")));
  function toggle(value: string) { onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]); }
  return <div className="pivot-filter"><span>{label}</span><button type="button" className="pivot-filter-trigger" onClick={() => setOpen((current) => !current)}>{selected.length ? `${selected.length}개 선택` : "전체"}<b>⌄</b></button>{open && <div className="pivot-popover"><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`${label} 검색`} /><div className="pivot-actions"><button type="button" onClick={() => onChange(visible)}>검색 결과 모두</button><button type="button" onClick={() => onChange([])}>전체로</button></div><div className="pivot-options">{visible.length ? visible.map((value) => <label key={value}><input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} /><span>{value}</span></label>) : <p>일치하는 선택지가 없습니다.</p>}</div></div>}</div>;
}

export function PnlWorkspace() {
  const configuredClient = getSupabaseBrowserClient();
  const hasClient = Boolean(configuredClient);
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [filterOptions, setFilterOptions] = useState(sampleFilters);
  const [rows, setRows] = useState<StatementRow[]>(sampleStatementRows);
  const [matrixRows, setMatrixRows] = useState<MatrixRecord[]>([]);
  const [source, setSource] = useState<"sample" | "supabase">("sample");
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState<LayoutConfig>(systemPresets[0].config);
  const [activeAxis, setActiveAxis] = useState<Axis>("rows");
  const [presetMessage, setPresetMessage] = useState<string | null>(null);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [fieldExamples, setFieldExamples] = useState<Record<string, string[]>>(initialFieldExamples);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedMeasures, setSelectedMeasures] = useState<StatementCode[]>(statementOrder.map((item) => item.code));
  const [draggedItem, setDraggedItem] = useState<DraggedAxisItem | null>(null);
  const [dragOverAxis, setDragOverAxis] = useState<Axis | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const yearDragStart = useRef<string | null>(null);
  const suppressYearClick = useRef(false);
  const activeBreakdownDimensions = useMemo(() => breakdownDimensions.filter((dimension) => layout.rows.includes(dimension.label)), [layout.rows]);
  useEffect(() => {
    const client = configuredClient;
    if (!client) return;
    async function loadBuilderData(activeClient: NonNullable<typeof client>) {
      const { data, error } = await activeClient.rpc("pnl_filter_options", { p_dataset: filters.dataset === "전체" ? null : filters.dataset });
      if (error || !data) return;
      const options = data as FilterOptionPayload;
      setDatasets(options.datasets ?? []);
      setFilterOptions({ years: options.years?.length ? options.years : sampleFilters.years, periods: sampleFilters.periods, products: options.products ?? [], brands: options.brands ?? [], customers: options.customers ?? [], sites: options.sites ?? [] });
      setFieldExamples({
        ...initialFieldExamples,
        "기간": spacedExamples(options.years ?? [], initialFieldExamples["기간"]),
        "제품": spacedExamples(options.products ?? [], initialFieldExamples["제품"]), "브랜드": spacedExamples(options.brands ?? [], initialFieldExamples["브랜드"]),
        "고객구분": spacedExamples(options.customers ?? [], initialFieldExamples["고객구분"]), "사업장": spacedExamples(options.sites ?? [], initialFieldExamples["사업장"]),
      });
    }
    void loadBuilderData(client);
  }, [configuredClient, filters.dataset]);

  useEffect(() => {
    const client = configuredClient;
    if (!client) { setRows(sampleStatementRows); setMatrixRows([]); setSource("sample"); return; }
    if (!selectedMeasures.length) { setRows(statementOrder.map(({ code, label }) => ({ code, label, amount: null }))); setMatrixRows([]); setSource("supabase"); return; }
    async function loadRows(activeClient: NonNullable<typeof client>) {
      setLoading(true);
      const parameters = {
        p_dataset: filters.dataset === "전체" ? null : filters.dataset,
        p_years: filters.selectedYears.length ? filters.selectedYears.map(Number) : null,
        p_year_from: filters.selectedYears.length ? null : (filters.yearFrom ? Number(filters.yearFrom) : null),
        p_year_to: filters.selectedYears.length ? null : (filters.yearTo ? Number(filters.yearTo) : null),
        p_products: filters.product.length ? filters.product : null,
        p_brands: filters.brand.length ? filters.brand : null,
        p_customers: filters.customer.length ? filters.customer : null,
        p_sites: filters.site.length ? filters.site : null,
      };
      const [totals, matrix] = await Promise.all([
        activeClient.rpc("pnl_statement_totals", parameters),
        activeClient.rpc("pnl_statement_matrix", { p_dimensions: activeBreakdownDimensions.map((dimension) => dimension.value), ...parameters }),
      ]);
      if (!totals.error && totals.data) { setRows(asRows(totals.data as { account_code: StatementCode; amount: number | string }[])); setSource("supabase"); }
      if (!matrix.error && matrix.data) setMatrixRows(matrix.data as MatrixRecord[]);
      else setMatrixRows([]);
      setLoading(false);
    }
    void loadRows(client);
  }, [configuredClient, filters, selectedMeasures, activeBreakdownDimensions]);

  useEffect(() => {
    const endYearDrag = () => { yearDragStart.current = null; };
    window.addEventListener("pointerup", endYearDrag);
    return () => window.removeEventListener("pointerup", endYearDrag);
  }, []);

  const operatingMargin = useMemo(() => {
    const sales = rows.find((row) => row.code === "sales")?.amount;
    const operatingProfit = rows.find((row) => row.code === "operating_profit")?.amount;
    return sales && operatingProfit !== null && operatingProfit !== undefined ? ((operatingProfit / sales) * 100).toFixed(1) : null;
  }, [rows]);
  const visibleRows = useMemo(() => rows.filter((row) => selectedMeasures.includes(row.code)), [rows, selectedMeasures]);
  const palette = paletteItems.filter((item) => item.includes(paletteSearch.trim()));
  const activePreset = systemPresets.find((preset) => JSON.stringify(preset.config) === JSON.stringify(layout));
  const availableYears = filterOptions.years.filter((year) => /^\d{4}$/.test(year)).sort((left, right) => Number(left) - Number(right));
  const periodColumns = useMemo(() => {
    const periods = new Map<string, number>();
    matrixRows.forEach((row) => periods.set(row.period_label, Number(row.period_sort)));
    return [...periods.entries()]
      .map(([label, sort]) => ({ label, sort }))
      .sort((left, right) => left.sort - right.sort || left.label.localeCompare(right.label, "ko"));
  }, [matrixRows]);
  const displayPeriods = periodColumns.length ? periodColumns : [{ label: "전체", sort: 0 }];
  const matrixGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    matrixRows.forEach((row) => {
      const values = activeBreakdownDimensions.map((dimension) => row.dimension_values[dimension.value] ?? "미지정");
      groups.set(JSON.stringify(values), values);
    });
    const valuesByGroup = groups.size ? [...groups.values()] : [[]];
    return valuesByGroup
      .sort((left, right) => left.join(" › ").localeCompare(right.join(" › "), "ko"))
      .map((values) => ({
        key: JSON.stringify(values),
        label: activeBreakdownDimensions.length ? values.join(" › ") : "전체",
        values,
        rows: statementOrder.filter(({ code }) => selectedMeasures.includes(code)).map(({ code, label }) => ({
          code,
          label,
          amounts: displayPeriods.map((period) => {
            if (!matrixRows.length) return rows.find((row) => row.code === code)?.amount ?? null;
            const record = matrixRows.find((row) => row.account_code === code
              && row.period_label === period.label
              && activeBreakdownDimensions.every((dimension, index) => (row.dimension_values[dimension.value] ?? "미지정") === values[index]));
            return record ? Number(record.amount) : null;
          }),
        })),
      }));
  }, [activeBreakdownDimensions, displayPeriods, matrixRows, rows, selectedMeasures]);
  const reportGridStyle = { gridTemplateColumns: `minmax(180px, 1.5fr) repeat(${displayPeriods.length}, minmax(120px, 1fr))` };

  function updateFilter(key: keyof FilterState, value: string) { setFilters((current) => ({ ...current, [key]: value })); }
  function updateMultiFilter(key: "product" | "brand" | "customer" | "site", values: string[]) { setFilters((current) => ({ ...current, [key]: values })); }
  function toggleYear(year: string) {
    if (suppressYearClick.current) { suppressYearClick.current = false; return; }
    setFilters((current) => ({ ...current, selectedYears: current.selectedYears.includes(year) ? current.selectedYears.filter((item) => item !== year) : [...current.selectedYears, year] }));
  }
  function startYearDrag(year: string, event: PointerEvent<HTMLButtonElement>) { if (event.button === 0) { yearDragStart.current = year; suppressYearClick.current = false; } }
  function extendYearDrag(year: string, event: PointerEvent<HTMLButtonElement>) {
    const start = yearDragStart.current;
    if (!start || event.buttons !== 1) return;
    const startIndex = availableYears.indexOf(start); const endIndex = availableYears.indexOf(year);
    if (startIndex < 0 || endIndex < 0) return;
    suppressYearClick.current = true;
    const range = availableYears.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1);
    setFilters((current) => ({ ...current, selectedYears: [...new Set([...current.selectedYears, ...range])]}));
  }
  function toggleMeasure(code: StatementCode) { setSelectedMeasures((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]); }
  function addToAxis(item: string) { setLayout((current) => current[activeAxis].includes(item) ? current : { ...current, [activeAxis]: [...current[activeAxis], item] }); }
  function removeFromAxis(axis: Axis, item: string) { setLayout((current) => ({ ...current, [axis]: current[axis].filter((value) => value !== item) })); }
  function moveAxisItem(axis: Axis, item: string, direction: -1 | 1) {
    setLayout((current) => {
      const list = [...current[axis]]; const index = list.indexOf(item); const next = index + direction;
      if (index < 0 || next < 0 || next >= list.length) return current;
      [list[index], list[next]] = [list[next], list[index]];
      return { ...current, [axis]: list };
    });
  }
  function startAxisDrag(event: DragEvent<HTMLElement>, axis: Axis, item: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${axis}:${item}`);
    setDraggedItem({ axis, item });
  }
  function placeDraggedItem(targetAxis: Axis, beforeItem?: string) {
    if (!draggedItem) return;
    if (draggedItem.axis === targetAxis && beforeItem === draggedItem.item) return;
    setLayout((current) => {
      const next: LayoutConfig = { rows: [...current.rows], columns: [...current.columns], filters: current.filters };
      next[draggedItem.axis] = next[draggedItem.axis].filter((value) => value !== draggedItem.item);
      const target = next[targetAxis];
      const targetIndex = beforeItem ? target.indexOf(beforeItem) : target.length;
      target.splice(targetIndex < 0 ? target.length : targetIndex, 0, draggedItem.item);
      return next;
    });
    setDraggedItem(null);
    setDragOverAxis(null);
  }
  function allowAxisDrop(event: DragEvent<HTMLElement>, axis: Axis) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOverAxis(axis); }
  function finishAxisDrop(event: DragEvent<HTMLElement>, axis: Axis, beforeItem?: string) { event.preventDefault(); event.stopPropagation(); placeDraggedItem(axis, beforeItem); }
  function endAxisDrag() { setDraggedItem(null); setDragOverAxis(null); }
  function swapAxes() { setLayout((current) => ({ ...current, rows: current.columns, columns: current.rows })); setActiveAxis((current) => current === "rows" ? "columns" : "rows"); }
  function applyPreset(preset: SavedPreset) { setLayout(ensureConfig(preset.config)); setPresetMessage(`‘${preset.name}’ 설정을 적용했습니다.`); }
  function downloadCsv() {
    const datasetName = filters.dataset === "전체" ? "전체" : datasets.find((dataset) => dataset.id === filters.dataset)?.name ?? "선택 데이터베이스";
    const yearRange = filters.selectedYears.length ? filters.selectedYears.sort().join(", ") : `${filters.yearFrom || "전체"}~${filters.yearTo || "전체"}`;
    const rowHeaders = activeBreakdownDimensions.length ? activeBreakdownDimensions.map((dimension) => dimension.label) : ["구분"];
    const data = [
      [...rowHeaders, "손익 항목", ...displayPeriods.map((period) => period.label)],
      ...matrixGroups.flatMap((group) => group.rows.map((row) => [
        ...(activeBreakdownDimensions.length ? group.values : ["전체"]),
        row.label,
        ...row.amounts,
      ])),
    ];
    const blob = new Blob(["\uFEFF" + data.map((line) => line.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `손익_${datasetName}_${yearRange}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }
  function selectFile(event: ChangeEvent<HTMLInputElement>) { setFile(event.target.files?.[0] ?? null); setUploadMessage(null); }
  async function uploadRaw() {
    if (!configuredClient || !file) { setUploadMessage(file ? "Supabase 연결 정보를 설정한 뒤 업로드할 수 있습니다." : "업로드할 XLSX 또는 CSV 파일을 선택하세요."); return; }
    if (!/\.(xlsx|csv)$/i.test(file.name)) { setUploadMessage("XLSX 또는 CSV 파일만 업로드할 수 있습니다."); return; }
    setUploadMessage("원본을 저장하는 중입니다…");
    const safeFileName = file.name.replace(/[\\/]/g, "_");
    const path = `raw/public/${crypto.randomUUID()}_${Date.now()}_${safeFileName}`;
    const upload = await configuredClient.storage.from("raw-data").upload(path, file, { upsert: false });
    if (upload.error) { setUploadMessage(`업로드 실패: ${upload.error.message}`); return; }
    const datasetName = file.name.replace(/\.[^.]+$/, "") || file.name;
    const batch = await configuredClient.rpc("create_public_demo_import", { p_source_filename: file.name, p_dataset_name: datasetName, p_source_storage_path: path });
    if (batch.error) { setUploadMessage(`배치 등록 실패: ${batch.error.message}`); return; }
    setUploadMessage(`‘${datasetName}’ 업로드가 완료되었습니다. 서버가 자동으로 검증·적재하며 완료 후 조회 데이터에 반영됩니다.`);
  }

  const filterDefinitions = [
    { key: "product" as const, label: "제품", values: filterOptions.products }, { key: "brand" as const, label: "브랜드", values: filterOptions.brands },
    { key: "customer" as const, label: "고객구분", values: filterOptions.customers }, { key: "site" as const, label: "사업장", values: filterOptions.sites },
  ];

  return <main className="analysis-app">
    <header className="analysis-topbar"><div className="analysis-logo">P/L<span>EXPLORER</span></div><nav><button className="topnav-active">손익 분석</button><button>기본 프리셋</button><button>이용자 지원</button></nav><div className="topbar-actions"><span className={hasClient ? "status-dot live" : "status-dot"} />{hasClient ? "공개 체험" : "테스트 모드"}</div></header>
    <div className="analysis-shell">
      <aside className="field-palette"><h1>손익 분석</h1><p>추천 프리셋부터 적용한 뒤 필요한 항목만 조정하세요.</p><div className="preset-strip"><div className="preset-heading"><span>추천 기본 프리셋</span><small>가장 빠른 시작 방법</small></div><div className="preset-grid">{systemPresets.map((preset, index) => <button key={preset.id} className={`preset preset-${index + 1}${activePreset?.id === preset.id ? " active" : ""}`} onClick={() => applyPreset(preset)}><b>{preset.name}</b><small>{preset.description}</small><em>{activePreset?.id === preset.id ? "적용 중" : "바로 적용"}</em></button>)}</div>{presetMessage && <p className="preset-message">{presetMessage}</p>}</div><input className="palette-search" value={paletteSearch} onChange={(event) => setPaletteSearch(event.target.value)} placeholder="항목 검색" />
        <div className="field-grid">{palette.map((item) => <div className="field-option" key={item}><button onClick={() => addToAxis(item)} aria-describedby={`examples-${item}`}><i>⋮⋮</i>{item}</button><div className="field-tooltip" id={`examples-${item}`} role="tooltip"><small>예시 값 · 25% / 50% / 75% 구간</small>{(fieldExamples[item] ?? initialFieldExamples[item]).map((example) => <span key={example}>{example}</span>)}</div></div>)}</div>
        <div className="run-row"><button className="reset-button" onClick={() => setLayout(systemPresets[0].config)} title="기본 설정으로 되돌리기">↻</button><button className="run-button" onClick={downloadCsv}>분석하기 <span>⌄</span></button></div>
      </aside>

      <section className="builder-area">
        <div className="builder-toolbar"><button className="swap-button" onClick={swapAxes}>행/열 바꾸기 <span>↔</span></button><div className="axis-tabs"><button className={activeAxis === "rows" ? "active" : ""} onClick={() => setActiveAxis("rows")}>행 <b>{layout.rows.length}</b></button><button className={activeAxis === "columns" ? "active" : ""} onClick={() => setActiveAxis("columns")}>열 <b>{layout.columns.length}</b></button></div><div className="builder-summary">현재 추가 위치: <strong>{activeAxis === "rows" ? "행" : "열"}</strong></div></div>
        <section className="axis-workbench"><div className="axis-card"><div className="axis-title"><span>행</span><small>손잡이를 끌어 순서·영역 변경</small></div><div className={dragOverAxis === "rows" ? "chip-zone drop-active" : "chip-zone"} onDragOver={(event) => allowAxisDrop(event, "rows")} onDrop={(event) => finishAxisDrop(event, "rows")} onDragLeave={() => setDragOverAxis(null)}>{layout.rows.length ? layout.rows.map((item) => <div className={draggedItem?.item === item ? "axis-chip row dragging" : "axis-chip row"} key={item} draggable onDragStart={(event) => startAxisDrag(event, "rows", item)} onDragEnd={endAxisDrag} onDragOver={(event) => allowAxisDrop(event, "rows")} onDrop={(event) => finishAxisDrop(event, "rows", item)} title="손잡이를 끌어 행·열을 바꾸거나 순서를 조정하세요"><span className="drag-handle" aria-hidden="true">⠿</span><span>{item}</span><button className="remove-chip" type="button" aria-label={`${item} 행에서 제거`} onClick={(event) => { event.stopPropagation(); removeFromAxis("rows", item); }}>×</button></div>) : <span className="empty-zone">여기에 항목을 놓으세요</span>}</div></div><div className="axis-card"><div className="axis-title"><span>열</span><small>손잡이를 끌어 순서·영역 변경</small></div><div className={dragOverAxis === "columns" ? "chip-zone drop-active" : "chip-zone"} onDragOver={(event) => allowAxisDrop(event, "columns")} onDrop={(event) => finishAxisDrop(event, "columns")} onDragLeave={() => setDragOverAxis(null)}>{layout.columns.length ? layout.columns.map((item) => <div className={draggedItem?.item === item ? "axis-chip column dragging" : "axis-chip column"} key={item} draggable onDragStart={(event) => startAxisDrag(event, "columns", item)} onDragEnd={endAxisDrag} onDragOver={(event) => allowAxisDrop(event, "columns")} onDrop={(event) => finishAxisDrop(event, "columns", item)} title="손잡이를 끌어 행·열을 바꾸거나 순서를 조정하세요"><span className="drag-handle" aria-hidden="true">⠿</span><span>{item}</span><button className="remove-chip" type="button" aria-label={`${item} 열에서 제거`} onClick={(event) => { event.stopPropagation(); removeFromAxis("columns", item); }}>×</button></div>) : <span className="empty-zone">여기에 항목을 놓으세요</span>}</div></div></section>
        <section className="filter-bar"><strong>필터</strong><label><span>데이터베이스</span><select value={filters.dataset} onChange={(event) => updateFilter("dataset", event.target.value)}><option value="전체">전체</option>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label><div className="year-picker"><span>기간</span><div className="year-range"><select value={filters.yearFrom} onChange={(event) => updateFilter("yearFrom", event.target.value)}><option value="">시작 연도</option>{availableYears.map((year) => <option key={year} value={year}>{year}</option>)}</select><i>~</i><select value={filters.yearTo} onChange={(event) => updateFilter("yearTo", event.target.value)}><option value="">종료 연도</option>{availableYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></div><div className="year-select-actions"><small>개별 선택 또는 클릭 후 끌어 연속 선택</small>{filters.selectedYears.length > 0 && <button type="button" onClick={() => setFilters((current) => ({ ...current, selectedYears: [] }))}>개별 선택 해제</button>}</div><div className="year-checkboxes">{availableYears.map((year) => <button type="button" role="checkbox" aria-checked={filters.selectedYears.includes(year)} className={filters.selectedYears.includes(year) ? "checked" : ""} key={year} onPointerDown={(event) => startYearDrag(year, event)} onPointerEnter={(event) => extendYearDrag(year, event)} onClick={() => toggleYear(year)}>{filters.selectedYears.includes(year) ? "✓" : ""} {year}</button>)}</div></div>{filterDefinitions.filter((filter) => layout.filters.includes(filter.label)).map((filter) => <PivotFilter key={filter.key} label={filter.label} values={filter.values.filter((value) => value !== "전체")} selected={filters[filter.key]} onChange={(values) => updateMultiFilter(filter.key, values)} />)}<button className="filter-more" onClick={() => setLayout((current) => ({ ...current, filters: paletteItems.filter((item) => !["측정치", "기간"].includes(item)) }))}>필터 더보기</button></section>
        <section className="measure-picker"><div className="measure-picker-heading"><div><strong>조회 손익 항목</strong><span>행·열 배치와 별개로 조회할 측정치를 선택합니다.</span></div><button type="button" className="measure-reset" onClick={() => setSelectedMeasures(statementOrder.map((item) => item.code))}>전체 선택</button></div><div className="measure-options">{statementOrder.map(({ code, label }) => <label className={selectedMeasures.includes(code) ? "measure-option checked" : "measure-option"} key={code}><input type="checkbox" checked={selectedMeasures.includes(code)} onChange={() => toggleMeasure(code)} /><span>{label}</span></label>)}</div><p>{selectedMeasures.length ? `${selectedMeasures.length}개 항목 선택됨` : "최소 1개 이상 선택하세요"}</p></section>
        <section className="search-panel"><div><strong>조회 설계</strong><span>행과 열은 비교 기준, 손익 항목은 별도 선택으로 조합합니다.</span></div><button className="detail-search">상세검색</button></section>
        <section className="report-panel"><div className="report-heading"><div><p>미리보기</p><h2>{activePreset?.name ?? "사용자 지정 분석"}</h2></div><div className="report-meta"><span>{layout.rows.join(" · ") || "행 없음"}</span><b>×</b><span>{layout.columns.join(" · ") || "열 없음"}</span></div></div><div className="report-table"><div className="report-row report-header" style={reportGridStyle}><span>{activeBreakdownDimensions.length ? `${activeBreakdownDimensions.map((dimension) => dimension.label).join(" › ")} › 손익 항목` : "손익 항목"}</span>{displayPeriods.map((period) => <span key={period.label}>{period.label}</span>)}</div>{matrixGroups.map((group) => <div className="report-group" key={group.key}>{activeBreakdownDimensions.length > 0 && <div className="report-row report-group-header" style={reportGridStyle}><strong>{group.label}</strong></div>}{group.rows.map((row) => <div className={row.code === "operating_profit" ? "report-row strong" : "report-row"} style={reportGridStyle} key={`${group.key}-${row.code}`}><span>{row.label}</span>{row.amounts.map((value, index) => <b key={`${row.code}-${index}`}>{loading ? "불러오는 중…" : amount(value)}</b>)}</div>)}</div>)}</div><footer>{source === "sample" ? "공개 체험용 예시 데이터를 표시 중입니다." : "Supabase 적재 데이터를 기준으로 표시 중입니다."}<span>영업이익률 {operatingMargin ?? "-"}%</span></footer></section>
      <section className="upload-inline"><div><strong>RAW 업로드</strong><span>로그인 없이 XLSX 또는 CSV 원본을 업로드하면 몇 분 내 손익 데이터까지 자동 적재합니다.</span></div><label className="file-label"><input type="file" accept=".xlsx,.csv" onChange={selectFile} /><em>{file?.name ?? "XLSX 또는 CSV 파일 선택"}</em></label><button className="primary-button" onClick={uploadRaw}>업로드 및 적재</button>{uploadMessage && <p>{uploadMessage}</p>}</section>
      </section>

      <aside className="selection-panel"><div className="selection-title"><div><strong>선택된 항목</strong><small>⋮⋮ 손잡이를 끌어 순서·행/열 변경</small></div><span>{layout.rows.length + layout.columns.length}개</span></div><div className="selection-group" onDragOver={(event) => allowAxisDrop(event, "rows")} onDrop={(event) => finishAxisDrop(event, "rows")}><h3>행 [{layout.rows.length}]</h3>{layout.rows.map((item) => <div className={draggedItem?.item === item ? "selected-item dragging" : "selected-item"} key={`row-${item}`} draggable onDragStart={(event) => startAxisDrag(event, "rows", item)} onDragEnd={endAxisDrag} onDragOver={(event) => allowAxisDrop(event, "rows")} onDrop={(event) => finishAxisDrop(event, "rows", item)}><span>⋮⋮ {item}</span><button onClick={() => moveAxisItem("rows", item, -1)}>↑</button><button onClick={() => moveAxisItem("rows", item, 1)}>↓</button><button onClick={() => removeFromAxis("rows", item)}>×</button></div>)}</div><div className="selection-group" onDragOver={(event) => allowAxisDrop(event, "columns")} onDrop={(event) => finishAxisDrop(event, "columns")}><h3>열 [{layout.columns.length}]</h3>{layout.columns.map((item) => <div className={draggedItem?.item === item ? "selected-item dragging" : "selected-item"} key={`column-${item}`} draggable onDragStart={(event) => startAxisDrag(event, "columns", item)} onDragEnd={endAxisDrag} onDragOver={(event) => allowAxisDrop(event, "columns")} onDrop={(event) => finishAxisDrop(event, "columns", item)}><span>⋮⋮ {item}</span><button onClick={() => moveAxisItem("columns", item, -1)}>↑</button><button onClick={() => moveAxisItem("columns", item, 1)}>↓</button><button onClick={() => removeFromAxis("columns", item)}>×</button></div>)}</div><div className="recommended-presets"><h3>기본 프리셋으로 빠르게 시작</h3><p>색상 카드를 선택하면 권장 행·열 구성이 즉시 적용됩니다.</p>{systemPresets.map((preset) => <button key={preset.id} onClick={() => applyPreset(preset)}><span>기본</span>{preset.name}</button>)}</div></aside>
    </div>
  </main>;
}
