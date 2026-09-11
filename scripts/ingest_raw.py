"""Normalize the P&L RAW Excel template and optionally load it into Supabase.

By default this script is a dry run. Use --write only after creating an
import_batches record and setting SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from openpyxl import load_workbook


CORE_ACCOUNTS = {
    "매출액": ("sales", "매출액", None, 10, True),
    "매출원가": ("cogs", "매출원가", None, 20, True),
    "매출총이익": ("gross_profit", "매출총이익", None, 30, True),
    "판매비와관리비": ("sga", "판매비와관리비", None, 40, True),
    "연구개발비": ("rnd", "연구개발비", None, 50, True),
    "영업이익": ("operating_profit", "영업이익", None, 60, True),
}

DIMENSION_COLUMNS = {
    0: "source_year",
    1: "material_type_code",
    2: "material_type_name",
    3: "product_hierarchy_code",
    4: "product_hierarchy_name",
    5: "product_hierarchy_sub_code",
    6: "product_hierarchy_sub_name",
    7: "product_name",
    8: "brand",
    9: "classification",
    10: "efficacy_group",
    11: "company_name",
    12: "country_name",
    13: "customer_group_code",
    14: "customer_group_name",
    15: "category_large",
    16: "category_middle",
    17: "category_small",
    18: "site_code",
    19: "site_name",
    20: "field_name",
}


@dataclass(frozen=True)
class Account:
    code: str
    name: str
    parent: str | None
    display_order: int
    statement_row: bool
    source_position: int
    source_name: str


def number(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip().replace(",", "")) if value.strip() else 0.0
        except ValueError:
            return 0.0
    return 0.0


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()
    return normalized or "metric"


def parent_for(header: str) -> str | None:
    if header.startswith("매출액") or header.startswith("순매출액"):
        return "sales"
    if header.startswith("매출원가"):
        return "cogs"
    if header.startswith(("영업직접", "마케팅직접", "영업간접", "일반관리", "급료와임금")):
        return "sga"
    if header.startswith("연구개발"):
        return "rnd"
    return None


def build_accounts(headers: list[Any]) -> tuple[list[Account], list[str]]:
    accounts: list[Account] = []
    skipped: list[str] = []
    for index, raw_header in enumerate(headers[21:], start=21):
        header = str(raw_header or "").strip()
        if not header:
            continue
        if header in {"판매수량", "콜건수"}:
            skipped.append(header)
            continue
        position = index + 1
        if header in CORE_ACCOUNTS:
            code, name, parent, order, statement = CORE_ACCOUNTS[header]
        else:
            code = f"metric_{position:03d}_{slug(header)}"
            name = header
            parent = parent_for(header)
            order = 1000 + position
            statement = False
        accounts.append(Account(code, name, parent, order, statement, position, header))
    return accounts, skipped


def read_source(path: Path) -> tuple[list[Any], list[tuple[Any, ...]]]:
    if path.suffix.lower() == ".csv":
        last_error: UnicodeDecodeError | None = None
        for encoding in ("utf-8-sig", "cp949", "euc-kr"):
            try:
                with path.open("r", encoding=encoding, newline="") as source:
                    reader = csv.reader(source)
                    headers = next(reader)
                    return headers, [tuple(row) for row in reader]
            except UnicodeDecodeError as error:
                last_error = error
        raise ValueError("CSV 인코딩을 읽을 수 없습니다. UTF-8 또는 CP949 CSV를 사용하세요.") from last_error
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    iterator = sheet.values
    headers = list(next(iterator))
    return headers, list(iterator)


def value_at(row: tuple[Any, ...], index: int) -> Any:
    return row[index] if index < len(row) else None


def source_year(value: Any) -> int | None:
    if isinstance(value, (int, float)) and 2000 <= int(value) <= 2100:
        return int(value)
    match = re.search(r"(?:19|20)\d{2}", str(value or ""))
    return int(match.group()) if match else None


def normalize(path: Path, default_year: int | None = None, default_quarter: str | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    headers, rows = read_source(path)
    if len(headers) < 129:
        raise ValueError(f"RAW 열 수가 예상보다 적습니다: {len(headers)}개")
    accounts, skipped_metrics = build_accounts(headers)
    facts: list[dict[str, Any]] = []
    invalid_rows: list[int] = []
    gross_mismatch = 0
    operating_mismatch = 0
    account_by_position = {account.source_position - 1: account for account in accounts}

    for source_row_number, row in enumerate(rows, start=2):
        dimensions = {target: value_at(row, index) for index, target in DIMENSION_COLUMNS.items()}
        if not dimensions["product_name"] and not dimensions["site_name"]:
            invalid_rows.append(source_row_number)
            continue

        sales = number(value_at(row, 24))
        cogs = number(value_at(row, 31))
        gross_profit = number(value_at(row, 42))
        sga = number(value_at(row, 43))
        rnd = number(value_at(row, 120))
        operating_profit = number(value_at(row, 128))
        if round(sales - cogs - gross_profit, 2) != 0:
            gross_mismatch += 1
        if round(gross_profit - sga - rnd - operating_profit, 2) != 0:
            operating_mismatch += 1

        for source_index, account in account_by_position.items():
            amount = number(value_at(row, source_index))
            if amount == 0:
                continue
            facts.append({
                "source_row_number": source_row_number,
                "fiscal_year": source_year(dimensions["source_year"]) or default_year,
                "fiscal_quarter": default_quarter,
                "material_type_code": dimensions["material_type_code"],
                "material_type_name": dimensions["material_type_name"],
                "product_hierarchy_code": dimensions["product_hierarchy_code"],
                "product_hierarchy_name": dimensions["product_hierarchy_name"],
                "product_name": dimensions["product_name"],
                "brand": dimensions["brand"],
                "classification": dimensions["classification"],
                "efficacy_group": dimensions["efficacy_group"],
                "company_name": dimensions["company_name"],
                "country_name": dimensions["country_name"],
                "customer_group_code": dimensions["customer_group_code"],
                "customer_group_name": dimensions["customer_group_name"],
                "category_large": dimensions["category_large"],
                "category_middle": dimensions["category_middle"],
                "category_small": dimensions["category_small"],
                "site_code": dimensions["site_code"],
                "site_name": dimensions["site_name"],
                "account_code": account.code,
                "amount": amount,
            })

    account_rows = [
        {
            "account_code": account.code,
            "account_name": account.name,
            "parent_account_code": account.parent,
            "display_order": account.display_order,
            "account_level": 1 if account.statement_row else 2,
            "is_statement_row": account.statement_row,
            "source_column_position": account.source_position,
            "source_column_name": account.source_name,
        }
        for account in accounts
    ]
    report = {
        "source_file": path.name,
        "dataset_name": path.stem,
        "source_rows": len(rows),
        "valid_rows": len(rows) - len(invalid_rows),
        "invalid_rows": len(invalid_rows),
        "invalid_row_numbers": invalid_rows[:100],
        "fact_rows": len(facts),
        "mapped_accounts": len(accounts),
        "skipped_metrics": skipped_metrics,
        "gross_profit_mismatch_rows": gross_mismatch,
        "operating_profit_mismatch_rows": operating_mismatch,
        "dimension_distinct_counts": {
            "product": len({value_at(row, 7) for row in rows if value_at(row, 7)}),
            "brand": len({value_at(row, 8) for row in rows if value_at(row, 8)}),
            "business_site": len({value_at(row, 18) for row in rows if value_at(row, 18)}),
        },
    }
    return account_rows, facts, report


def request_json(url: str, method: str, headers: dict[str, str], payload: Any | None = None) -> Any:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = Request(url, data=body, method=method, headers=headers)
    try:
        with urlopen(request) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except HTTPError as error:
        detail = error.read().decode("utf-8")
        raise RuntimeError(f"Supabase API 오류 ({error.code}): {detail}") from error


def request_bytes(url: str, headers: dict[str, str]) -> bytes:
    request = Request(url, method="GET", headers=headers)
    try:
        with urlopen(request) as response:
            return response.read()
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase Storage 오류 ({error.code}): {detail}") from error


def supabase_settings() -> tuple[str, dict[str, str]]:
    base_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base_url or not service_key:
        raise RuntimeError("SUPABASE_URL 및 SUPABASE_SECRET_KEY가 필요합니다.")
    headers = {"apikey": service_key, "Content-Type": "application/json"}
    if not service_key.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {service_key}"
    return base_url, headers


def chunks(values: list[dict[str, Any]], size: int = 500) -> Iterable[list[dict[str, Any]]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def write_to_supabase(accounts: list[dict[str, Any]], facts: list[dict[str, Any]], report: dict[str, Any], batch_id: str) -> None:
    base_url, api_headers = supabase_settings()
    headers = {**api_headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
    # A failed run can have written only some fact chunks. Clear that batch
    # before retrying so a later worker run cannot double-count it.
    request_json(
        f"{base_url}/rest/v1/pl_facts?import_batch_id=eq.{quote(batch_id)}",
        "DELETE",
        {**api_headers, "Prefer": "return=minimal"},
    )
    request_json(f"{base_url}/rest/v1/pl_accounts?on_conflict=account_code", "POST", headers, accounts)
    for batch in chunks(facts):
        for record in batch:
            record["import_batch_id"] = batch_id
        request_json(f"{base_url}/rest/v1/pl_facts", "POST", headers, batch)

    update_headers = {**headers, "Prefer": "return=minimal"}
    request_json(
        f"{base_url}/rest/v1/import_batches?id=eq.{batch_id}",
        "PATCH",
        update_headers,
        {
            "status": "completed",
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "row_count": report["source_rows"],
            "valid_row_count": report["valid_rows"],
            "invalid_row_count": report["invalid_rows"],
            "validation_result": report,
        },
    )


def mark_batch_failed(batch_id: str, error: Exception) -> None:
    base_url, headers = supabase_settings()
    request_json(
        f"{base_url}/rest/v1/import_batches?id=eq.{quote(batch_id)}",
        "PATCH",
        {**headers, "Prefer": "return=minimal"},
        {
            "status": "failed",
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "validation_result": {"error": str(error)[:1000]},
        },
    )


def process_pending_batches(limit: int) -> int:
    """Claim uploaded RAW files, download them privately, and write normalized facts."""
    base_url, headers = supabase_settings()
    query = "status=eq.uploaded&select=id,source_filename,source_storage_path&order=uploaded_at.asc&limit=" + str(limit)
    candidates = request_json(f"{base_url}/rest/v1/import_batches?{query}", "GET", headers) or []
    processed = 0
    for candidate in candidates:
        batch_id = str(candidate["id"])
        source_path = str(candidate.get("source_storage_path") or "")
        source_name = str(candidate.get("source_filename") or "source.xlsx")
        if Path(source_name).suffix.lower() not in {".xlsx", ".csv"}:
            error = ValueError("XLSX 또는 CSV RAW 파일만 적재할 수 있습니다.")
            mark_batch_failed(batch_id, error)
            print(f"실패 {batch_id}: {error}")
            continue

        claimed = request_json(
            f"{base_url}/rest/v1/import_batches?id=eq.{quote(batch_id)}&status=eq.uploaded",
            "PATCH",
            {**headers, "Prefer": "return=representation"},
            {"status": "processing"},
        )
        if not claimed:
            continue

        temporary_path = Path.cwd() / ".tmp-ingest" / f"{batch_id}{Path(source_name).suffix.lower()}"
        try:
            temporary_path.parent.mkdir(exist_ok=True)
            raw = request_bytes(
                f"{base_url}/storage/v1/object/raw-data/{quote(source_path, safe='/')}",
                headers,
            )
            temporary_path.write_bytes(raw)
            accounts, facts, report = normalize(temporary_path)
            report["source_file"] = source_name
            report["dataset_name"] = Path(source_name).stem
            write_to_supabase(accounts, facts, report, batch_id)
            processed += 1
            print(f"완료 {batch_id}: {source_name} ({report['fact_rows']} facts)")
        except Exception as error:
            try:
                mark_batch_failed(batch_id, error)
            except Exception as status_error:
                print(f"상태 기록 실패 {batch_id}: {status_error}", file=sys.stderr)
            print(f"실패 {batch_id}: {error}", file=sys.stderr)
        finally:
            temporary_path.unlink(missing_ok=True)
    return processed


def main() -> int:
    parser = argparse.ArgumentParser(description="손익 RAW XLSX/CSV 정규화 및 Supabase 적재")
    parser.add_argument("--file", type=Path)
    parser.add_argument("--year", type=int, help="원본에 연도 값이 없을 때만 사용할 선택 값")
    parser.add_argument("--quarter", choices=["Q1", "Q2", "Q3", "Q4"], help="원본에 분기 값이 없을 때만 사용할 선택 값")
    parser.add_argument("--batch-id", help="Supabase import_batches ID. --write에서 필수")
    parser.add_argument("--write", action="store_true", help="Supabase에 실제 적재")
    parser.add_argument("--report", type=Path, help="검증 결과 JSON 저장 경로")
    parser.add_argument("--process-pending", action="store_true", help="업로드 대기 배치를 Supabase Storage에서 받아 적재")
    parser.add_argument("--limit", type=int, default=3, help="한 실행에서 처리할 최대 대기 배치 수")
    args = parser.parse_args()

    if args.process_pending:
        if args.file or args.write or args.batch_id:
            parser.error("--process-pending은 --file, --write, --batch-id와 함께 사용할 수 없습니다.")
        if args.limit < 1 or args.limit > 20:
            parser.error("--limit은 1~20 사이여야 합니다.")
        processed = process_pending_batches(args.limit)
        print(f"대기 배치 처리 완료: {processed}개")
        return 0

    if not args.file:
        parser.error("--file 또는 --process-pending이 필요합니다.")
    if not args.file.exists():
        raise FileNotFoundError(args.file)
    if args.write and not args.batch_id:
        parser.error("--write 사용 시 --batch-id가 필요합니다.")

    accounts, facts, report = normalize(args.file, args.year, args.quarter)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.write:
        write_to_supabase(accounts, facts, report, args.batch_id)
        print("Supabase 적재 완료")
    else:
        print("Dry run 완료: --write를 지정하지 않아 Supabase에는 적재하지 않았습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
