"""Normalize the P&L RAW Excel template and optionally load it into Supabase.

By default this script is a dry run. Use --write only after creating an
import_batches record and setting SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
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
    return float(value) if isinstance(value, (int, float)) else 0.0


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
    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook.active
    iterator = sheet.values
    headers = list(next(iterator))
    return headers, list(iterator)


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
        dimensions = {target: row[index] for index, target in DIMENSION_COLUMNS.items()}
        if not dimensions["product_name"] and not dimensions["site_name"]:
            invalid_rows.append(source_row_number)
            continue

        sales = number(row[24])
        cogs = number(row[31])
        gross_profit = number(row[42])
        sga = number(row[43])
        rnd = number(row[120])
        operating_profit = number(row[128])
        if round(sales - cogs - gross_profit, 2) != 0:
            gross_mismatch += 1
        if round(gross_profit - sga - rnd - operating_profit, 2) != 0:
            operating_mismatch += 1

        for source_index, account in account_by_position.items():
            amount = number(row[source_index])
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
            "product": len({row[7] for row in rows if row[7]}),
            "brand": len({row[8] for row in rows if row[8]}),
            "business_site": len({row[18] for row in rows if row[18]}),
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


def chunks(values: list[dict[str, Any]], size: int = 500) -> Iterable[list[dict[str, Any]]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def write_to_supabase(accounts: list[dict[str, Any]], facts: list[dict[str, Any]], report: dict[str, Any], batch_id: str) -> None:
    base_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    service_key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base_url or not service_key:
        raise RuntimeError("SUPABASE_URL 및 SUPABASE_SECRET_KEY가 필요합니다.")

    headers = {
        "apikey": service_key,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    # New sb_secret keys must be sent only as an API key; the legacy JWT key
    # still uses the Authorization header for compatibility.
    if not service_key.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {service_key}"
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


def main() -> int:
    parser = argparse.ArgumentParser(description="손익 RAW Excel 정규화 및 Supabase 적재")
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--year", type=int, help="원본에 연도 값이 없을 때만 사용할 선택 값")
    parser.add_argument("--quarter", choices=["Q1", "Q2", "Q3", "Q4"], help="원본에 분기 값이 없을 때만 사용할 선택 값")
    parser.add_argument("--batch-id", help="Supabase import_batches ID. --write에서 필수")
    parser.add_argument("--write", action="store_true", help="Supabase에 실제 적재")
    parser.add_argument("--report", type=Path, help="검증 결과 JSON 저장 경로")
    args = parser.parse_args()

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
