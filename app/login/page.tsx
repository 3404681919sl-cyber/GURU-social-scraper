"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { browserInternalUrl } from "@/lib/preview-url";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    const error = new URL(window.location.href).searchParams.get("error");
    if (error) setMessage(error);
  }, []);

  async function signInWithEmail(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return setMessage("请先在 EdgeOne 配置 Supabase 环境变量。");
    const redirectTo = browserInternalUrl("/auth/callback");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    setMessage(error ? error.message : "登录链接已发送，请检查邮箱。");
  }

  async function signInWithGitHub() {
    if (!supabase) return setMessage("请先在 EdgeOne 配置 Supabase 环境变量。");
    const { error } = await supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: browserInternalUrl("/auth/callback") } });
    if (error) setMessage(`GitHub 登录不可用：${error.message}`);
  }

  return <main className="login-shell"><section className="login-card"><Link href="/" className="login-back" onClick={(event) => { event.preventDefault(); window.location.assign(browserInternalUrl("/")); }}>← 返回工作台</Link><span className="kicker">CROSS-DEVICE ACCOUNT</span><h1>登录采集台</h1><p>登录后，任务、快照与自动化配置会同步到不同设备。</p><form onSubmit={signInWithEmail}><label className="field"><span>邮箱</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label><button className="primary" type="submit">发送免密码登录链接</button></form><div className="login-divider">或</div><button type="button" className="secondary login-provider" onClick={signInWithGitHub}>使用 GitHub 登录（需先配置 Provider）</button>{message && <div className="login-message">{message}</div>}</section></main>;
}
