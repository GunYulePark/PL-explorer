export type StatementCode =
  | "sales"
  | "cogs"
  | "gross_profit"
  | "sga"
  | "rnd"
  | "operating_profit";

export type StatementRow = {
  code: StatementCode;
  label: string;
  amount: number | null;
  detail?: { label: string; amount: number }[];
};

export const statementOrder: { code: StatementCode; label: string }[] = [
  { code: "sales", label: "매출액" },
  { code: "cogs", label: "매출원가" },
  { code: "gross_profit", label: "매출총이익" },
  { code: "sga", label: "판매비와관리비" },
  { code: "rnd", label: "연구개발비" },
  { code: "operating_profit", label: "영업이익" },
];
