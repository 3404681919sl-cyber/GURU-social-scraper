import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const { supabase, user } = await getCurrentUser();
  if (!user || !supabase) return Response.json({ authenticated: false, schedules: [] });
  const result = await supabase.from("schedules").select("*").order("created_at", { ascending: false });
  if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
  return Response.json({ authenticated: true, schedules: result.data });
}

export async function POST(request: Request) {
  const { supabase, user } = await getCurrentUser();
  if (!user || !supabase) return Response.json({ error: "请先登录后创建自动化任务" }, { status: 401 });
  const payload = (await request.json()) as { name?: string; frequency?: string; scope?: string; active?: boolean };
  if (!payload.name?.trim() || !payload.frequency?.trim()) return Response.json({ error: "name 和 frequency 为必填项" }, { status: 400 });
  const record = {
    id: crypto.randomUUID(),
    user_id: user.id,
    name: payload.name.trim(),
    frequency: payload.frequency.trim(),
    scope: payload.scope?.trim() || "all",
    active: payload.active ?? true,
    next_run: null,
  };
  const result = await supabase.from("schedules").insert(record).select().single();
  if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
  return Response.json({ schedule: record }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { supabase, user } = await getCurrentUser();
  if (!user || !supabase) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = (await request.json()) as { id?: string; active?: boolean };
  if (!payload.id || typeof payload.active !== "boolean") return Response.json({ error: "id 和 active 为必填项" }, { status: 400 });
  const result = await supabase.from("schedules").update({ active: payload.active }).eq("id", payload.id).select().single();
  if (result.error) return Response.json({ error: result.error.message }, { status: 500 });
  return Response.json({ schedule: result.data });
}
