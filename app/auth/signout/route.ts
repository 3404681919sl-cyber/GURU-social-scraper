import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { carryPreviewAccess } from "@/lib/preview-url";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const supabase = await getSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(carryPreviewAccess(url, new URL("/", url.origin)));
}
