"""Build native Excel PivotTable exports requested by the public P/L Explorer.

The GitHub Actions worker is the trusted boundary: it reads only requested
facts using the service key, writes a filtered RAW sheet into a prebuilt Excel
template, then uploads the result to private Storage.  A browser never gets
the original upload or a service credential.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode
from urllib.error import HTTPError
from urllib.request import Request, urlopen

SCRIPTS_DIRECTORY = Path(__file__).resolve().parent
if str(SCRIPTS_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIRECTORY))
from ingest_raw import request_json, supabase_settings


TEMPLATE = Path(__file__).resolve().parents[1] / "assets" / "pnl-native-pivot-template.xlsx"
HEADERS = ["fiscal_year", "fiscal_quarter", "product_name", "brand", "customer_group_name", "site_name", "account_code", "account_name", "amount"]
STATEMENT_CODES = ["sales", "cogs", "gross_profit", "sga", "rnd", "operating_profit"]
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def xml_escape(value: Any) -> str:
    return (str(value if value is not None else "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&apos;"))


def column_name(number: int) -> str:
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def as_in(values: list[Any]) -> str:
    # PostgREST's in operator accepts quoted values. Backslash/quote escaping
    # keeps a value selected from the UI from altering the REST expression.
    escaped = []
    for value in values:
        text = str(value).replace("\\", "\\\\").replace('"', '\\"')
        escaped.append(f'"{text}"')
    return "in.(" + ",".join(escaped) + ")"


def get_json_with_headers(url: str, headers: dict[str, str]) -> tuple[Any, dict[str, str]]:
    request = Request(url, method="GET", headers=headers)
    try:
        with urlopen(request) as response:
            raw = response.read().decode("utf-8")
            return (json.loads(raw) if raw else None), dict(response.headers.items())
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase API 오류 ({error.code}): {detail}") from error


def account_names(base_url: str, headers: dict[str, str]) -> dict[str, str]:
    rows = request_json(f"{base_url}/rest/v1/pl_accounts?select=account_code,account_name", "GET", headers) or []
    return {str(row["account_code"]): str(row["account_name"]) for row in rows}


def fact_query(batch_id: str, request: dict[str, Any]) -> dict[str, str]:
    params: dict[str, str] = {
        "select": "fiscal_year,fiscal_quarter,product_name,brand,customer_group_name,site_name,account_code,amount",
        "import_batch_id": f"eq.{batch_id}",
        "account_code": as_in(STATEMENT_CODES),
        "order": "source_row_number.asc,account_code.asc",
    }
    years = [year for year in request.get("years", []) if isinstance(year, int) or (isinstance(year, str) and year.isdigit())]
    if years:
        params["fiscal_year"] = as_in([int(year) for year in years])
    elif request.get("year_from") is not None and request.get("year_to") is not None:
        params["and"] = f"(fiscal_year.gte.{int(request['year_from'])},fiscal_year.lte.{int(request['year_to'])})"
    elif request.get("year_from") is not None:
        params["fiscal_year"] = f"gte.{int(request['year_from'])}"
    elif request.get("year_to") is not None:
        params["fiscal_year"] = f"lte.{int(request['year_to'])}"
    for key, field in (("products", "product_name"), ("brands", "brand"), ("customers", "customer_group_name"), ("sites", "site_name")):
        values = [value for value in request.get(key, []) if isinstance(value, str) and value]
        if values: params[field] = as_in(values)
    return params


def fetch_filtered_facts(base_url: str, headers: dict[str, str], batch_id: str, request: dict[str, Any]) -> list[dict[str, Any]]:
    params = fact_query(batch_id, request)
    rows: list[dict[str, Any]] = []
    offset = 0
    page_size = 1000
    while True:
        response, _ = get_json_with_headers(
            f"{base_url}/rest/v1/pl_facts?{urlencode(params)}",
            {**headers, "Range-Unit": "items", "Range": f"{offset}-{offset + page_size - 1}"},
        )
        page = response or []
        rows.extend(page)
        if len(page) < page_size:
            return rows
        offset += page_size


def raw_sheet_xml(rows: list[dict[str, Any]], names: dict[str, str]) -> bytes:
    all_rows: list[list[Any]] = [HEADERS]
    for fact in rows:
        all_rows.append([
            fact.get("fiscal_year"), fact.get("fiscal_quarter"), fact.get("product_name"), fact.get("brand"),
            fact.get("customer_group_name"), fact.get("site_name"), fact.get("account_code"),
            names.get(str(fact.get("account_code")), str(fact.get("account_code") or "")), fact.get("amount"),
        ])
    xml_rows: list[str] = []
    for row_index, values in enumerate(all_rows, start=1):
        cells: list[str] = []
        for column_index, value in enumerate(values, start=1):
            cell = f"{column_name(column_index)}{row_index}"
            if column_index in (1, 9) and row_index > 1 and value not in (None, ""):
                cells.append(f'<c r="{cell}"><v>{xml_escape(value)}</v></c>')
            else:
                cells.append(f'<c r="{cell}" t="inlineStr"><is><t>{xml_escape(value)}</t></is></c>')
        xml_rows.append(f'<row r="{row_index}" spans="1:9">{"".join(cells)}</row>')
    last_row = len(all_rows)
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<worksheet xmlns="{NS}" xmlns:r="{REL_NS}">'
            f'<dimension ref="A1:I{last_row}"/><sheetViews><sheetView workbookViewId="0">'
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="17.4"/>'
            '<cols><col min="1" max="1" width="12" customWidth="1"/><col min="2" max="2" width="13" customWidth="1"/>'
            '<col min="3" max="6" width="22" customWidth="1"/><col min="7" max="8" width="18" customWidth="1"/>'
            '<col min="9" max="9" width="16" customWidth="1"/></cols>'
            f'<sheetData>{"".join(xml_rows)}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
            '<tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>').encode("utf-8")


def table_xml(original: bytes, last_row: int) -> bytes:
    root = ET.fromstring(original)
    root.set("ref", f"A1:I{last_row}")
    filter_node = root.find(f"{{{NS}}}autoFilter")
    if filter_node is not None: filter_node.set("ref", f"A1:I{last_row}")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def cache_xml(original: bytes, record_count: int) -> bytes:
    root = ET.fromstring(original)
    root.set("refreshOnLoad", "1")
    root.set("enableRefresh", "1")
    root.set("recordCount", str(record_count))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def render_workbook(destination: Path, rows: list[dict[str, Any]], names: dict[str, str]) -> None:
    if not TEMPLATE.exists(): raise FileNotFoundError(f"PivotTable 템플릿을 찾을 수 없습니다: {TEMPLATE}")
    replacements: dict[str, bytes] = {}
    with zipfile.ZipFile(TEMPLATE, "r") as source:
        replacements["xl/worksheets/sheet2.xml"] = raw_sheet_xml(rows, names)
        replacements["xl/tables/table1.xml"] = table_xml(source.read("xl/tables/table1.xml"), len(rows) + 1)
        replacements["xl/pivotCache/pivotCacheDefinition1.xml"] = cache_xml(source.read("xl/pivotCache/pivotCacheDefinition1.xml"), len(rows))
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as output:
            for item in source.infolist():
                output.writestr(item, replacements.get(item.filename, source.read(item.filename)))


def upload_workbook(base_url: str, headers: dict[str, str], storage_path: str, workbook: Path) -> None:
    body = workbook.read_bytes()
    request = Request(
        f"{base_url}/storage/v1/object/pnl-exports/{quote(storage_path, safe='/')}", data=body, method="POST",
        headers={**headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "x-upsert": "true"},
    )
    try:
        with urlopen(request): pass
    except HTTPError as error:
        raise RuntimeError(f"Excel 결과 업로드 오류 ({error.code}): {error.read().decode('utf-8', errors='replace')}") from error


def fail_job(base_url: str, headers: dict[str, str], job_id: str, error: Exception) -> None:
    request_json(f"{base_url}/rest/v1/pivot_export_jobs?id=eq.{quote(job_id)}", "PATCH", {**headers, "Prefer": "return=minimal"}, {
        "status": "failed", "processed_at": datetime.now(timezone.utc).isoformat(), "error_message": str(error)[:1000],
    })


def process_pending(limit: int) -> int:
    base_url, headers = supabase_settings()
    jobs = request_json(f"{base_url}/rest/v1/pivot_export_jobs?status=eq.queued&select=id,import_batch_id,request&order=created_at.asc&limit={limit}", "GET", headers) or []
    names = account_names(base_url, headers)
    complete = 0
    for job in jobs:
        job_id = str(job["id"])
        claimed = request_json(f"{base_url}/rest/v1/pivot_export_jobs?id=eq.{quote(job_id)}&status=eq.queued", "PATCH", {**headers, "Prefer": "return=representation"}, {"status": "processing"})
        if not claimed: continue
        temporary = Path(tempfile.mkdtemp(prefix="pnl-pivot-")) / "pivot.xlsx"
        try:
            facts = fetch_filtered_facts(base_url, headers, str(job["import_batch_id"]), job.get("request") or {})
            render_workbook(temporary, facts, names)
            storage_path = f"pivot/{job_id}.xlsx"
            filename = f"P_L_Explorer_Pivot_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
            upload_workbook(base_url, headers, storage_path, temporary)
            request_json(f"{base_url}/rest/v1/pivot_export_jobs?id=eq.{quote(job_id)}", "PATCH", {**headers, "Prefer": "return=minimal"}, {
                "status": "completed", "processed_at": datetime.now(timezone.utc).isoformat(), "result_storage_path": storage_path, "result_filename": filename, "error_message": None,
            })
            complete += 1
            print(f"완료 {job_id}: {len(facts):,} filtered facts")
        except Exception as error:
            try: fail_job(base_url, headers, job_id, error)
            except Exception as status_error: print(f"상태 기록 실패 {job_id}: {status_error}")
            print(f"실패 {job_id}: {error}")
        finally:
            shutil.rmtree(temporary.parent, ignore_errors=True)
    return complete


def main() -> int:
    parser = argparse.ArgumentParser(description="필터 적용 네이티브 PivotTable Excel 생성")
    parser.add_argument("--process-pending", action="store_true")
    parser.add_argument("--limit", type=int, default=1)
    args = parser.parse_args()
    if not args.process_pending: parser.error("--process-pending이 필요합니다.")
    if not 1 <= args.limit <= 5: parser.error("--limit은 1~5 사이여야 합니다.")
    print(f"내보내기 요청 처리 완료: {process_pending(args.limit)}개")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
