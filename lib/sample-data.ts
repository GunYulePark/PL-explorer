import { statementOrder, type StatementRow } from "@/lib/types";

// Public builds do not bundle any source-RAW aggregates. Supabase data takes
// precedence as soon as the project URL and anon key are configured.
export const sampleStatementRows: StatementRow[] = statementOrder.map(({ code, label }) => ({ code, label, amount: null }));

export const sampleFilters = {
  years: ["2023"],
  periods: ["연간"],
  products: ["전체"],
  brands: ["전체"],
  customers: ["전체"],
  sites: ["전체"],
};
