import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const siteOrigin = "https://gunyulepark.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": siteOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Expose-Headers": "X-Dataset-Name, X-Source-Filename, Content-Type",
  "Vary": "Origin",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET") return jsonError("GET 요청만 허용됩니다.", 405);
  if (request.headers.get("origin") !== siteOrigin) return jsonError("허용되지 않은 출처입니다.", 403);

  const batchId = new URL(request.url).searchParams.get("dataset") ?? "";
  if (batchId && !uuid.test(batchId)) return jsonError("유효하지 않은 데이터베이스입니다.", 400);

  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  const serviceKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !supabaseUrl) return jsonError("서버 설정이 완료되지 않았습니다.", 500);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const batchRequest = admin.from("import_batches").select("dataset_name, source_filename, source_storage_path").eq("status", "completed");
  const { data: batch, error: batchError } = batchId
    ? await batchRequest.eq("id", batchId).maybeSingle()
    : await batchRequest.order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  if (batchError || !batch || !/^raw\/public\/[^/]+\.(xlsx|csv)$/i.test(batch.source_storage_path)) return jsonError("완료된 원본을 찾을 수 없습니다.", 404);

  const { data: source, error: sourceError } = await admin.storage.from("raw-data").download(batch.source_storage_path);
  if (sourceError || !source) return jsonError("원본 파일을 읽을 수 없습니다.", 502);

  return new Response(source.stream(), {
    headers: {
      ...corsHeaders,
      "Content-Type": source.type || "application/octet-stream",
      "Content-Disposition": "attachment",
      "X-Dataset-Name": encodeURIComponent(batch.dataset_name),
      "X-Source-Filename": encodeURIComponent(batch.source_filename),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
