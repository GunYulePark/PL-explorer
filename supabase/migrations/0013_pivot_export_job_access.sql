-- Keep this queue private. The public demo uses narrowly scoped RPCs instead
-- of allowing direct table reads or writes through PostgREST.
create policy "deny direct public pivot export job access"
on public.pivot_export_jobs
for all to anon, authenticated
using (false)
with check (false);
