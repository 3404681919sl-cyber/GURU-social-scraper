import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { carryPreviewAccess } from "@/lib/preview-url";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const supabase = await getSupabaseServerClient();
  if (!code) {
    const target = new URL("/login", url.origin);
    target.searchParams.set("error", "登录回调缺少授权代码，请重新登录。");
    return NextResponse.redirect(carryPreviewAccess(url, target));
  }
  if (!supabase) {
    const target = new URL("/login", url.origin);
    target.searchParams.set("error", "Supabase 环境变量未配置。");
    return NextResponse.redirect(carryPreviewAccess(url, target));
  }
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const target = new URL("/login", url.origin);
    target.searchParams.set("error", `登录失败：${error.message}`);
    return NextResponse.redirect(carryPreviewAccess(url, target));
  }
  return NextResponse.redirect(carryPreviewAccess(url, new URL("/", url.origin)));
}
