import { getSupabaseServerClient } from "@/lib/supabase/server";
import Workbench from "./workbench";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await getSupabaseServerClient();
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const user = data.user;

  return (
    <Workbench
      user={user ? { name: user.user_metadata.full_name || user.user_metadata.name || user.email || "用户", email: user.email || "" } : null}
      signInHref="/login"
      signOutHref="/auth/signout"
    />
  );
}
