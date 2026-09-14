-- Preserve the row-axis order while grouping the bounded statement aggregate.
create or replace function public.pnl_statement_breakdown_multi(
  p_dimensions text[],
  p_dataset uuid default null,
  p_years integer[] default null,
  p_year_from integer default null,
  p_year_to integer default null,
  p_products text[] default null,
  p_brands text[] default null,
  p_customers text[] default null,
  p_sites text[] default null
)
returns table (dimension_values jsonb, account_code text, amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select group_values.dimension_values, f.account_code, sum(f.amount) as amount
  from public.pl_facts f
  join public.import_batches b on b.id = f.import_batch_id
  cross join lateral (
    select jsonb_object_agg(dimension, value) as dimension_values
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
  where cardinality(p_dimensions) between 1 and 4
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
  group by group_values.dimension_values, f.account_code;
$$;

revoke all on function public.pnl_statement_breakdown_multi(text[], uuid, integer[], integer, integer, text[], text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.pnl_statement_breakdown_multi(text[], uuid, integer[], integer, integer, text[], text[], text[], text[]) to anon, authenticated;
