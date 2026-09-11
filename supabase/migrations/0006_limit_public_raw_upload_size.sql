-- Public demo uploads deliberately allow anonymous users, so bound the cost of
-- each queued worker job. The current sample (about 6.3 MB) is within this cap.
create or replace function public.create_public_demo_import(
  p_source_filename text,
  p_dataset_name text,
  p_source_storage_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_size bigint;
begin
  if p_source_filename is null or length(trim(p_source_filename)) = 0 or length(p_source_filename) > 255 then
    raise exception 'A valid source filename is required.';
  end if;
  if p_dataset_name is null or length(trim(p_dataset_name)) = 0 or length(p_dataset_name) > 255 then
    raise exception 'A valid dataset name is required.';
  end if;
  if p_source_storage_path !~ '(?i)^raw/public/[^/]+\\.(xlsx|csv)$' then
    raise exception 'Only public XLSX or CSV upload paths can create an import.';
  end if;

  select (metadata ->> 'size')::bigint into source_size
  from storage.objects
  where bucket_id = 'raw-data' and name = p_source_storage_path;
  if source_size is null then
    raise exception 'The uploaded source file does not exist.';
  end if;
  if source_size < 1 or source_size > 20971520 then
    raise exception 'Public RAW uploads must be between 1 byte and 20 MB.';
  end if;

  insert into public.import_batches (source_filename, dataset_name, source_storage_path, uploaded_by)
  values (trim(p_source_filename), trim(p_dataset_name), p_source_storage_path, null);
end;
$$;

revoke all on function public.create_public_demo_import(text, text, text) from public, anon, authenticated;
grant execute on function public.create_public_demo_import(text, text, text) to anon;

drop policy if exists "anonymous upload demo raw data" on storage.objects;
create policy "anonymous upload demo raw data"
on storage.objects for insert to anon
with check (
  bucket_id = 'raw-data'
  and (storage.foldername(name))[1] = 'raw'
  and (storage.foldername(name))[2] = 'public'
  and lower(storage.extension(name)) in ('xlsx', 'csv')
  and (metadata ->> 'size')::bigint between 1 and 20971520
);
