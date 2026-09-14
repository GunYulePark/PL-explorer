-- Bounded pivot source for row dimensions and actual fiscal periods.
create or replace function public.pnl_statement_matrix(
  p_dimensions text[] default array[]::text[],
  p_dataset uuid default null,
  p_years integer[] default null,
  p_year_from integer default null,
  p_year_to integer default null,
  p_products text[] default null,
  p_brands text[] default null,
  p_customers text[] default null,
  p_sites text[] default null
)
returns table (dimension_values jsonb, period_label text, period_sort integer, account_code text, amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    group_values.dimension_values,
    case
      when f.fiscal_year is null then '미지정'
      when f.fiscal_quarter is null or btrim(f.fiscal_quarter) = '' then f.fiscal_year::text
      else f.fiscal_year::text || ' ' || f.fiscal_quarter
    end as period_label,
    coalesce(f.fiscal_year, 0) * 10 + case f.fiscal_quarter when 'Q1' then 1 when 'Q2' then 2 when 'Q3' then 3 when 'Q4' then 4 else 0 end as period_sort,
    f.account_code,
    sum(f.amount) as amount
  from public.pl_facts f
  join public.import_batches b on b.id = f.import_batch_id
  cross join lateral (
    select coalesce(jsonb_object_agg(dimension, value), '{}'::jsonb) as dimension_values
    from unnest(p_dimensions) as requested(dimension)
    cross join lateral (
      values (coalesce(nullif(btrim(case requested.dimension
        when 'product' then f.product_name
        when 'brand' then f.brand
        when 'customer' then f.customer_group_name
        when 'site' then f.site_name
      end), ''), '미지정'))
    ) as chosen(value)
  ) group_values
  where cardinality(p_dimensions) between 0 and 4
    and p_dimensions <@ array['product', 'brand', 'customer', 'site']::text[]
    and b.status = 'completed'
    and f.account_code = any (array['sales', 'cogs', 'gross_profit', 'sga', 'rnd', 'operating_profit']::text[])
    and (p_dataset is null or f.import_batch_id = p_dataset)
    and (coalesce(cardinality(p_years), 0) = 0 or f.fiscal_year = any (p_years))
    and (p_year_from is null or f.fiscal_year >= p_year_from)
    and (p_year_to is null or f.fiscal_year <= p_year_to)
    and (coalesce(cardinality(p_products), 0) = 0 or f.product_name = any (p_products))
    and (coalesce(cardinality(p_brands), 0) = 0 or f.brand = any (p_brands))
    and (coalesce(cardinality(p_customers), 0) = 0 or f.customer_group_name = any (p_customers))
    and (coalesce(cardinality(p_sites), 0) = 0 or f.site_name = any (p_sites))
  group by group_values.dimension_values, f.fiscal_year, f.fiscal_quarter, f.account_code;
$$;

revoke all on function public.pnl_statement_matrix(text[], uuid, integer[], integer, integer, text[], text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.pnl_statement_matrix(text[], uuid, integer[], integer, integer, text[], text[], text[], text[]) to anon, authenticated;
