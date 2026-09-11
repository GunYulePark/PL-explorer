insert into public.pl_accounts (account_code, account_name, display_order, account_level, is_statement_row, source_column_name)
values
  ('sales', '매출액', 10, 1, true, '매출액'),
  ('cogs', '매출원가', 20, 1, true, '매출원가'),
  ('gross_profit', '매출총이익', 30, 1, true, '매출총이익'),
  ('sga', '판매비와관리비', 40, 1, true, '판매비와관리비'),
  ('rnd', '연구개발비', 50, 1, true, '연구개발비'),
  ('operating_profit', '영업이익', 60, 1, true, '영업이익')
on conflict (account_code) do update
set account_name = excluded.account_name,
    display_order = excluded.display_order,
    is_statement_row = excluded.is_statement_row,
    source_column_name = excluded.source_column_name;

insert into public.analysis_presets (name, description, config, is_system_default)
values
  ('기본 손익표', '손익 항목을 행으로, 기간을 열로 조회', '{"rows":["손익 항목"],"columns":["기간"],"filters":["제품","브랜드","고객구분","사업장"]}'::jsonb, true),
  ('품목별 분기 손익', '제품별 손익을 분기별로 비교', '{"rows":["제품","손익 항목"],"columns":["기간"],"filters":["브랜드","고객구분","사업장"]}'::jsonb, true),
  ('사업장별 수익성', '사업장별 매출·영업이익 비교', '{"rows":["사업장"],"columns":["측정치","기간"],"filters":["제품","브랜드","고객구분"]}'::jsonb, true)
on conflict (name) where is_system_default do update
set description = excluded.description,
    config = excluded.config;
