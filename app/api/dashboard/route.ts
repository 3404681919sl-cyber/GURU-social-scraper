import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const { supabase, user } = await getCurrentUser();
  if (!user || !supabase) return Response.json({ authenticated: false, tasks: [], snapshots: [] });

  const [taskResult, snapshotResult] = await Promise.all([
    supabase.from("scrape_tasks").select("*").order("created_at", { ascending: false }).limit(20),
    supabase.from("snapshots").select("*").eq("verification_status", "verified").order("captured_at", { ascending: false }).limit(100),
  ]);
  if (taskResult.error || snapshotResult.error) return Response.json({ error: taskResult.error?.message || snapshotResult.error?.message }, { status: 500 });
  return Response.json({ authenticated: true, tasks: taskResult.data, snapshots: snapshotResult.data });
}
