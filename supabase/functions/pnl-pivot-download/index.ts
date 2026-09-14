import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const siteOrigin = "https://gunyulepark.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": siteOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Type",
  "Vary": "Origin",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function error(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET") return error("GET 요청만 허용됩니다.", 405);
  if (request.headers.get("origin") !== siteOrigin) return error("허용되지 않은 출처입니다.", 403);
  const jobId = new URL(request.url).searchParams.get("job") ?? "";
  if (!uuid.test(jobId)) return error("유효하지 않은 내보내기 요청입니다.", 400);

  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  const serviceKey = keys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !supabaseUrl) return error("서버 설정이 완료되지 않았습니다.", 500);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: job, error: jobError } = await admin.from("pivot_export_jobs").select("status,result_storage_path,result_filename").eq("id", jobId).maybeSingle();
  if (jobError || !job || job.status !== "completed" || !job.result_storage_path) return error("완료된 Excel 파일을 찾을 수 없습니다.", 404);
  if (!/^pivot\/[0-9a-f-]+\.xlsx$/i.test(job.result_storage_path)) return error("잘못된 결과 경로입니다.", 404);
  const { data, error: downloadError } = await admin.storage.from("pnl-exports").download(job.result_storage_path);
  if (downloadError || !data) return error("Excel 파일을 읽을 수 없습니다.", 502);
  return new Response(data.stream(), { headers: { ...corsHeaders, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(job.result_filename ?? "P_L_Explorer_Pivot.xlsx")}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});
