-- Return only bounded statement aggregates, grouped by a validated display
-- dimension. Raw fact rows remain unavailable to the browser.
create or replace function public.pnl_statement_breakdown(
  p_dimension text,
  p_dataset uuid default null,
  p_years integer[] default null,
  p_year_from integer default null,
  p_year_to integer default null,
  p_products text[] default null,
  p_brands text[] default null,
  p_customers text[] default null,
  p_sites text[] default null
)
returns table (dimension_value text, account_code text, amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(nullif(btrim(case p_dimension
      when 'product' then f.product_name
      when 'brand' then f.brand
      when 'customer' then f.customer_group_name
      when 'site' then f.site_name
    end), ''), '미지정') as dimension_value,
    f.account_code,
    sum(f.amount) as amount
  from public.pl_facts f
  join public.import_batches b on b.id = f.import_batch_id
  where p_dimension = any (array['product', 'brand', 'customer', 'site']::text[])
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
  group by 1, f.account_code;
$$;

revoke all on function public.pnl_statement_breakdown(text, uuid, integer[], integer, integer, text[], text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.pnl_statement_breakdown(text, uuid, integer[], integer, integer, text[], text[], text[], text[]) to anon, authenticated;
