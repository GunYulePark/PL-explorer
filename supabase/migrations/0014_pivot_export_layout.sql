drop function public.create_public_pivot_export(uuid, integer[], integer, integer, text[], text[], text[], text[]);

create function public.create_public_pivot_export(
  p_dataset uuid default null,
  p_years integer[] default null,
  p_year_from integer default null,
  p_year_to integer default null,
  p_products text[] default null,
  p_brands text[] default null,
  p_customers text[] default null,
  p_sites text[] default null,
  p_layout jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare selected_batch uuid; job_id uuid;
begin
  if coalesce(cardinality(p_years), 0) > 50 or coalesce(cardinality(p_products), 0) > 200 or coalesce(cardinality(p_brands), 0) > 200 or coalesce(cardinality(p_customers), 0) > 200 or coalesce(cardinality(p_sites), 0) > 200 then raise exception '필터 선택 항목 수가 너무 많습니다.'; end if;
  if p_year_from is not null and (p_year_from < 2000 or p_year_from > 2100) then raise exception '시작 연도가 올바르지 않습니다.'; end if;
  if p_year_to is not null and (p_year_to < 2000 or p_year_to > 2100) then raise exception '종료 연도가 올바르지 않습니다.'; end if;
  if p_year_from is not null and p_year_to is not null and p_year_from > p_year_to then raise exception '시작 연도는 종료 연도보다 클 수 없습니다.'; end if;
  if p_dataset is null then select id into selected_batch from public.import_batches where status = 'completed' order by uploaded_at desc limit 1; else select id into selected_batch from public.import_batches where id = p_dataset and status = 'completed'; end if;
  if selected_batch is null then raise exception '완료된 데이터베이스를 찾을 수 없습니다.'; end if;
  insert into public.pivot_export_jobs (import_batch_id, request) values (selected_batch, jsonb_build_object(
    'years', coalesce(to_jsonb(p_years), '[]'::jsonb), 'year_from', p_year_from, 'year_to', p_year_to,
    'products', coalesce(to_jsonb(p_products), '[]'::jsonb), 'brands', coalesce(to_jsonb(p_brands), '[]'::jsonb),
    'customers', coalesce(to_jsonb(p_customers), '[]'::jsonb), 'sites', coalesce(to_jsonb(p_sites), '[]'::jsonb),
    'layout', case when jsonb_typeof(p_layout) = 'object' then p_layout else '{}'::jsonb end
  )) returning id into job_id;
  return job_id;
end;
$$;

revoke all on function public.create_public_pivot_export(uuid, integer[], integer, integer, text[], text[], text[], text[], jsonb) from public;
grant execute on function public.create_public_pivot_export(uuid, integer[], integer, integer, text[], text[], text[], text[], jsonb) to anon, authenticated;
