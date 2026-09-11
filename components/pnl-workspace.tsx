"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from "react";
import { sampleFilters, sampleStatementRows } from "@/lib/sample-data";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { statementOrder, type StatementCode, type StatementRow } from "@/lib/types";

type Axis = "rows" | "columns";
type DraggedAxisItem = { axis: Axis; item: string };
type FilterState = { year: string; period: string; product: string; brand: string; customer: string; site: string };
type LayoutConfig = { rows: string[]; columns: string[]; filters: string[] };
type SavedPreset = { id: string; name: string; description: string | null; config: LayoutConfig; isSystem: boolean };

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
const initialFilters: FilterState = { year: "2023", period: "연간", product: "전체", brand: "전체", customer: "전체", site: "전체" };
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

export function PnlWorkspace() {
  const configuredClient = getSupabaseBrowserClient();
  const hasClient = Boolean(configuredClient);
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [filterOptions, setFilterOptions] = useState(sampleFilters);
  const [rows, setRows] = useState<StatementRow[]>(sampleStatementRows);
  const [source, setSource] = useState<"sample" | "supabase">("sample");
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState<LayoutConfig>(systemPresets[0].config);
  const [activeAxis, setActiveAxis] = useState<Axis>("rows");
  const [presets, setPresets] = useState<SavedPreset[]>(systemPresets);
  const [presetName, setPresetName] = useState("");
  const [presetMessage, setPresetMessage] = useState<string | null>(null);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [fieldExamples, setFieldExamples] = useState<Record<string, string[]>>(initialFieldExamples);
  const [selectedMeasures, setSelectedMeasures] = useState<StatementCode[]>(statementOrder.map((item) => item.code));
  const [draggedItem, setDraggedItem] = useState<DraggedAxisItem | null>(null);
  const [dragOverAxis, setDragOverAxis] = useState<Axis | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadQuarter, setUploadQuarter] = useState("Q1");
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(!hasClient);
  const [authReady, setAuthReady] = useState(!hasClient);
  const [email, setEmail] = useState("");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    if (!configuredClient) return;
    configuredClient.auth.getSession().then(({ data }) => { setIsAuthenticated(Boolean(data.session)); setAuthReady(true); });
    const { data: listener } = configuredClient.auth.onAuthStateChange((_event, session) => { setIsAuthenticated(Boolean(session)); setAuthReady(true); });
    return () => listener.subscription.unsubscribe();
  }, [configuredClient]);

  useEffect(() => {
    const client = configuredClient;
    if (!client || !isAuthenticated) return;
    async function loadBuilderData(activeClient: NonNullable<typeof client>) {
      const [{ data: dimensionData }, { data: savedData }] = await Promise.all([
        activeClient.from("pl_facts").select("fiscal_year,fiscal_quarter,product_name,brand,classification,efficacy_group,customer_group_name,site_name,category_large,category_middle,category_small,country_name").limit(10000),
        activeClient.from("analysis_presets").select("id,name,description,config,is_system_default").order("is_system_default", { ascending: false }).order("created_at", { ascending: false }),
      ]);
      if (dimensionData) {
        const distinct = (key: keyof (typeof dimensionData)[number]) => [...new Set(dimensionData.map((item) => item[key]).filter(Boolean).map(String))].sort();
        const years = distinct("fiscal_year");
        setFilterOptions({ years: years.length ? years : sampleFilters.years, periods: ["연간", ...distinct("fiscal_quarter")], products: ["전체", ...distinct("product_name")], brands: ["전체", ...distinct("brand")], customers: ["전체", ...distinct("customer_group_name")], sites: ["전체", ...distinct("site_name")] });
        const examples = (key: keyof (typeof dimensionData)[number], label: string) => spacedExamples(dimensionData.map((item) => item[key] as string | number | null), initialFieldExamples[label]);
        setFieldExamples({
          ...initialFieldExamples,
          "기간": spacedExamples(dimensionData.map((item) => `${item.fiscal_year} ${item.fiscal_quarter}`), initialFieldExamples["기간"]),
          "제품": examples("product_name", "제품"), "브랜드": examples("brand", "브랜드"), "분류": examples("classification", "분류"), "효능군": examples("efficacy_group", "효능군"),
          "고객구분": examples("customer_group_name", "고객구분"), "사업장": examples("site_name", "사업장"), "대구분": examples("category_large", "대구분"),
          "중구분": examples("category_middle", "중구분"), "소구분": examples("category_small", "소구분"), "국가": examples("country_name", "국가"),
        });
      }
      if (savedData) setPresets(savedData.map((preset) => ({ id: preset.id, name: preset.name, description: preset.description, config: ensureConfig(preset.config), isSystem: preset.is_system_default })));
    }
    void loadBuilderData(client);
  }, [configuredClient, isAuthenticated]);

  useEffect(() => {
    const client = configuredClient;
    if (!client) { setRows(sampleStatementRows); setSource("sample"); return; }
    if (!isAuthenticated) return;
    if (!selectedMeasures.length) { setRows(statementOrder.map(({ code, label }) => ({ code, label, amount: null }))); setSource("supabase"); return; }
    async function loadRows(activeClient: NonNullable<typeof client>) {
      setLoading(true);
      let query = activeClient.from("pl_facts").select("account_code,amount").eq("fiscal_year", Number(filters.year)).in("account_code", selectedMeasures);
      if (filters.period !== "연간") query = query.eq("fiscal_quarter", filters.period);
      if (filters.product !== "전체") query = query.eq("product_name", filters.product);
      if (filters.brand !== "전체") query = query.eq("brand", filters.brand);
      if (filters.customer !== "전체") query = query.eq("customer_group_name", filters.customer);
      if (filters.site !== "전체") query = query.eq("site_name", filters.site);
      const { data, error } = await query;
      if (!error && data) { setRows(asRows(data as { account_code: StatementCode; amount: number | string }[])); setSource("supabase"); }
      setLoading(false);
    }
    void loadRows(client);
  }, [configuredClient, filters, isAuthenticated, selectedMeasures]);

  const operatingMargin = useMemo(() => {
    const sales = rows.find((row) => row.code === "sales")?.amount;
    const operatingProfit = rows.find((row) => row.code === "operating_profit")?.amount;
    return sales && operatingProfit !== null && operatingProfit !== undefined ? ((operatingProfit / sales) * 100).toFixed(1) : null;
  }, [rows]);
  const visibleRows = useMemo(() => rows.filter((row) => selectedMeasures.includes(row.code)), [rows, selectedMeasures]);
  const palette = paletteItems.filter((item) => item.includes(paletteSearch.trim()));
  const activePreset = presets.find((preset) => JSON.stringify(preset.config) === JSON.stringify(layout));

  function updateFilter(key: keyof FilterState, value: string) { setFilters((current) => ({ ...current, [key]: value })); }
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
    const data = [["손익 항목", `${filters.year} ${filters.period}`, "행 구성", "열 구성"], ...visibleRows.map((row) => [row.label, row.amount, layout.rows.join(" > "), layout.columns.join(" > ")])];
    const blob = new Blob(["\uFEFF" + data.map((line) => line.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `손익_${filters.year}_${filters.period}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }
  async function savePreset() {
    if (!presetName.trim()) { setPresetMessage("저장할 분석 설정 이름을 입력하세요."); return; }
    if (!configuredClient || !isAuthenticated) { setPresetMessage("개인 설정 저장은 Supabase 로그인 후 사용할 수 있습니다."); return; }
    const { data, error } = await configuredClient.from("analysis_presets").insert({ name: presetName.trim(), config: layout }).select("id,name,description,config,is_system_default").single();
    if (error || !data) { setPresetMessage(`저장 실패: ${error?.message ?? "알 수 없는 오류"}`); return; }
    setPresets((current) => [...current, { id: data.id, name: data.name, description: data.description, config: ensureConfig(data.config), isSystem: data.is_system_default }]);
    setPresetName(""); setPresetMessage("내 분석 설정으로 저장했습니다.");
  }
  function selectFile(event: ChangeEvent<HTMLInputElement>) { setFile(event.target.files?.[0] ?? null); setUploadMessage(null); }
  async function uploadRaw() {
    if (!configuredClient || !file) { setUploadMessage(file ? "Supabase 연결 정보를 설정한 뒤 업로드할 수 있습니다." : "업로드할 Excel 파일을 선택하세요."); return; }
    setUploadMessage("원본을 저장하는 중입니다…");
    const path = `raw/${filters.year}/${uploadQuarter}/${Date.now()}_${file.name}`;
    const upload = await configuredClient.storage.from("raw-data").upload(path, file, { upsert: false });
    if (upload.error) { setUploadMessage(`업로드 실패: ${upload.error.message}`); return; }
    const batch = await configuredClient.from("import_batches").insert({ source_filename: file.name, source_storage_path: path, fiscal_year: Number(filters.year), fiscal_quarter: uploadQuarter, status: "uploaded" });
    setUploadMessage(batch.error ? `배치 등록 실패: ${batch.error.message}` : "원본 저장 완료. Python 적재기로 배치를 처리하세요.");
  }
  async function sendMagicLink() {
    if (!configuredClient || !email) { setAuthMessage("회사 이메일을 입력하세요."); return; }
    setAuthMessage("로그인 링크를 보내는 중입니다…");
    const { error } = await configuredClient.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
    setAuthMessage(error ? `로그인 링크 발송 실패: ${error.message}` : "이메일로 로그인 링크를 보냈습니다.");
  }

  const filterDefinitions = [
    { key: "year" as const, label: "연도", values: filterOptions.years }, { key: "period" as const, label: "기간", values: filterOptions.periods },
    { key: "product" as const, label: "제품", values: filterOptions.products }, { key: "brand" as const, label: "브랜드", values: filterOptions.brands },
    { key: "customer" as const, label: "고객구분", values: filterOptions.customers }, { key: "site" as const, label: "사업장", values: filterOptions.sites },
  ];

  return <main className="analysis-app">
    <header className="analysis-topbar"><div className="analysis-logo">P/L<span>EXPLORER</span></div><nav><button className="topnav-active">손익 분석</button><button>저장 분석</button><button>이용자 지원</button></nav><div className="topbar-actions"><span className={hasClient && isAuthenticated ? "status-dot live" : "status-dot"} />{hasClient && isAuthenticated ? "연결됨" : "테스트 모드"}{hasClient && !isAuthenticated && <button className="text-button" onClick={() => setShowLogin((current) => !current)}>로그인</button>}{hasClient && isAuthenticated && <button className="text-button" onClick={() => void configuredClient?.auth.signOut()}>로그아웃</button>}</div></header>
    {hasClient && showLogin && !isAuthenticated && <section className="login-banner"><div><strong>실제 손익 데이터 연결</strong><span>테스트 화면은 로그인 없이 볼 수 있습니다. 데이터 조회·RAW 업로드·개인 설정 저장은 로그인 뒤 사용할 수 있습니다.</span></div><label><span>회사 이메일</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></label>{authReady ? <button className="primary-button" type="button" onClick={sendMagicLink}>로그인 링크 받기</button> : <span className="login-pending">로그인 상태 확인 중…</span>}<button className="login-close" type="button" onClick={() => setShowLogin(false)} aria-label="로그인 영역 닫기">×</button>{authMessage && <p>{authMessage}</p>}</section>}
    <div className="analysis-shell">
      <aside className="field-palette"><h1>손익 분석</h1><p>항목을 선택한 뒤 행 또는 열에 추가하세요.</p><div className="preset-strip"><span>기본 설정</span>{systemPresets.map((preset) => <button key={preset.id} className={activePreset?.id === preset.id ? "preset active" : "preset"} onClick={() => applyPreset(preset)}>{preset.name}</button>)}</div><input className="palette-search" value={paletteSearch} onChange={(event) => setPaletteSearch(event.target.value)} placeholder="항목 검색" />
        <div className="field-grid">{palette.map((item) => <div className="field-option" key={item}><button onClick={() => addToAxis(item)} aria-describedby={`examples-${item}`}><i>⋮⋮</i>{item}</button><div className="field-tooltip" id={`examples-${item}`} role="tooltip"><small>예시 값 · 25% / 50% / 75% 구간</small>{(fieldExamples[item] ?? initialFieldExamples[item]).map((example) => <span key={example}>{example}</span>)}</div></div>)}</div>
        <div className="run-row"><button className="reset-button" onClick={() => setLayout(systemPresets[0].config)} title="기본 설정으로 되돌리기">↻</button><button className="run-button" onClick={downloadCsv}>분석하기 <span>⌄</span></button></div>
      </aside>

      <section className="builder-area">
        <div className="builder-toolbar"><button className="swap-button" onClick={swapAxes}>행/열 바꾸기 <span>↔</span></button><div className="axis-tabs"><button className={activeAxis === "rows" ? "active" : ""} onClick={() => setActiveAxis("rows")}>행 <b>{layout.rows.length}</b></button><button className={activeAxis === "columns" ? "active" : ""} onClick={() => setActiveAxis("columns")}>열 <b>{layout.columns.length}</b></button></div><div className="builder-summary">현재 추가 위치: <strong>{activeAxis === "rows" ? "행" : "열"}</strong></div></div>
        <section className="axis-workbench"><div className="axis-card"><div className="axis-title"><span>행</span><small>손잡이를 끌어 순서·영역 변경</small></div><div className={dragOverAxis === "rows" ? "chip-zone drop-active" : "chip-zone"} onDragOver={(event) => allowAxisDrop(event, "rows")} onDrop={(event) => finishAxisDrop(event, "rows")} onDragLeave={() => setDragOverAxis(null)}>{layout.rows.length ? layout.rows.map((item) => <div className={draggedItem?.item === item ? "axis-chip row dragging" : "axis-chip row"} key={item} draggable onDragStart={(event) => startAxisDrag(event, "rows", item)} onDragEnd={endAxisDrag} onDragOver={(event) => allowAxisDrop(event, "rows")} onDrop={(event) => finishAxisDrop(event, "rows", item)} title="손잡이를 끌어 행·열을 바꾸거나 순서를 조정하세요"><span className="drag-handle" aria-hidden="true">⠿</span><span>{item}</span><button className="remove-chip" type="button" aria-label={`${item} 행에서 제거`} onClick={(event) => { event.stopPropagation(); removeFromAxis("rows", item); }}>×</button></div>) : <span className="empty-zone">여기에 항목을 놓으세요</span>}</div></div><div className="axis-card"><div className="axis-title"><span>열</span><small>손잡이를 끌어 순서·영역 변경</small></div><div className={dragOverAxis === "columns" ? "chip-zone drop-active" : "chip-zone"} onDragOver={(event) => allowAxisDrop(event, "columns")} onDrop={(event) => finishAxisDrop(event, "columns")} onDragLeave={() => setDragOverAxis(null)}>{layout.columns.length ? layout.columns.map((item) => <div className={draggedItem?.item === item ? "axis-chip column dragging" : "axis-chip column"} key={item} draggable onDragStart={(event) => startAxisDrag(event, "columns", item)} onDragEnd={endAxisDrag} onDragOver={(event) => allowAxisDrop(event, "columns")} onDrop={(event) => finishAxisDrop(event, "columns", item)} title="손잡이를 끌어 행·열을 바꾸거나 순서를 조정하세요"><span className="drag-handle" aria-hidden="true">⠿</span><span>{item}</span><button className="remove-chip" type="button" aria-label={`${item} 열에서 제거`} onClick={(event) => { event.stopPropagation(); removeFromAxis("columns", item); }}>×</button></div>) : <span className="empty-zone">여기에 항목을 놓으세요</span>}</div></div></section>
        <section className="filter-bar"><strong>필터</strong>{filterDefinitions.filter((filter) => layout.filters.includes(filter.label)).map((filter) => <label key={filter.key}><span>{filter.label}</span><select value={filters[filter.key]} onChange={(event) => updateFilter(filter.key, event.target.value)}>{filter.values.map((value) => <option key={value}>{value}</option>)}</select></label>)}<button className="filter-more" onClick={() => setLayout((current) => ({ ...current, filters: paletteItems.filter((item) => !["측정치", "기간"].includes(item)) }))}>필터 더보기</button></section>
        <section className="measure-picker"><div className="measure-picker-heading"><div><strong>조회 손익 항목</strong><span>행·열 배치와 별개로 조회할 측정치를 선택합니다.</span></div><button type="button" className="measure-reset" onClick={() => setSelectedMeasures(statementOrder.map((item) => item.code))}>전체 선택</button></div><div className="measure-options">{statementOrder.map(({ code, label }) => <label className={selectedMeasures.includes(code) ? "measure-option checked" : "measure-option"} key={code}><input type="checkbox" checked={selectedMeasures.includes(code)} onChange={() => toggleMeasure(code)} /><span>{label}</span></label>)}</div><p>{selectedMeasures.length ? `${selectedMeasures.length}개 항목 선택됨` : "최소 1개 이상 선택하세요"}</p></section>
        <section className="search-panel"><div><strong>조회 설계</strong><span>행과 열은 비교 기준, 손익 항목은 별도 선택으로 조합합니다.</span></div><button className="detail-search">상세검색</button></section>
        <section className="report-panel"><div className="report-heading"><div><p>미리보기</p><h2>{activePreset?.name ?? "사용자 지정 분석"}</h2></div><div className="report-meta"><span>{layout.rows.join(" · ") || "행 없음"}</span><b>×</b><span>{layout.columns.join(" · ") || "열 없음"}</span></div></div><div className="report-table"><div className="report-row report-header"><span>구분</span><span>{filters.year} {filters.period}</span></div>{visibleRows.map((row) => <div className={row.code === "operating_profit" ? "report-row strong" : "report-row"} key={row.code}><span>{row.label}</span><b>{loading ? "불러오는 중…" : amount(row.amount)}</b></div>)}</div><footer>{source === "sample" ? "Supabase 연결 후 저장된 손익 데이터를 조회할 수 있습니다." : "Supabase 적재 데이터를 기준으로 표시 중입니다."}<span>영업이익률 {operatingMargin ?? "-"}%</span></footer></section>
        <section className="upload-inline"><div><strong>RAW 업로드</strong><span>연도·분기를 지정해 원본을 저장하고 적재 배치를 생성합니다.</span></div><label className="file-label"><input type="file" accept=".xlsx" onChange={selectFile} /><em>{file?.name ?? "Excel 파일 선택"}</em></label><select value={uploadQuarter} onChange={(event) => setUploadQuarter(event.target.value)}><option>Q1</option><option>Q2</option><option>Q3</option><option>Q4</option></select><button className="primary-button" onClick={uploadRaw}>원본 저장</button>{uploadMessage && <p>{uploadMessage}</p>}</section>
      </section>

      <aside className="selection-panel"><div className="selection-title"><div><strong>선택된 항목</strong><small>⋮⋮ 손잡이를 끌어 순서·행/열 변경</small></div><span>{layout.rows.length + layout.columns.length}개</span></div><div className="selection-group" onDragOver={(event) => allowAxisDrop(event, "rows")} onDrop={(event) => finishAxisDrop(event, "rows")}><h3>행 [{layout.rows.length}]</h3>{layout.rows.map((item) => <div className={draggedItem?.item === item ? "selected-item dragging" : "selected-item"} key={`row-${item}`} draggable onDragStart={(event) => startAxisDrag(event, "rows", item)} onDragEnd={endAxisDrag} onDragOver={(event) => allowAxisDrop(event, "rows")} onDrop={(event) => finishAxisDrop(event, "rows", item)}><span>⋮⋮ {item}</span><button onClick={() => moveAxisItem("rows", item, -1)}>↑</button><button onClick={() => moveAxisItem("rows", item, 1)}>↓</button><button onClick={() => removeFromAxis("rows", item)}>×</button></div>)}</div><div className="selection-group" onDragOver={(event) => allowAxisDrop(event, "columns")} onDrop={(event) => finishAxisDrop(event, "columns")}><h3>열 [{layout.columns.length}]</h3>{layout.columns.map((item) => <div className={draggedItem?.item === item ? "selected-item dragging" : "selected-item"} key={`column-${item}`} draggable onDragStart={(event) => startAxisDrag(event, "columns", item)} onDragEnd={endAxisDrag} onDragOver={(event) => allowAxisDrop(event, "columns")} onDrop={(event) => finishAxisDrop(event, "columns", item)}><span>⋮⋮ {item}</span><button onClick={() => moveAxisItem("columns", item, -1)}>↑</button><button onClick={() => moveAxisItem("columns", item, 1)}>↓</button><button onClick={() => removeFromAxis("columns", item)}>×</button></div>)}</div><div className="save-preset"><strong>내 분석 저장</strong><input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="예: OTC 월간 손익" /><button className="primary-button" onClick={savePreset}>현재 설정 저장</button>{presetMessage && <p>{presetMessage}</p>}</div><div className="saved-presets"><h3>저장된 설정</h3>{presets.map((preset) => <button key={preset.id} onClick={() => applyPreset(preset)}><span>{preset.isSystem ? "기본" : "개인"}</span>{preset.name}</button>)}</div></aside>
    </div>
  </main>;
}
