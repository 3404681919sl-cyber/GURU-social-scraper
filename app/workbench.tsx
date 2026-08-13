"use client";

import { useEffect, useMemo, useState } from "react";
import { browserInternalUrl } from "@/lib/preview-url";

type User = { name: string; email: string } | null;
type Section = "collect" | "dashboard" | "automation";

type ResultPost = {
  noteId: string;
  title: string;
  url: string;
  author: string | null;
  content: string | null;
  publishedAt: string | null;
  tags: string[];
  likes: number;
  comments: number;
  saves: number;
  capturedAt: string;
  source: "agent-browser";
  verification: "verified";
};
type BrowserState = "idle" | "opening" | "authorization-required" | "checking" | "ready" | "error";
type DashboardRow = { title: string; date: string; likes: number; comments: number; saves: number; delta: number };
type Schedule = { id: string; name: string; frequency: string; scope: string; active: boolean; next_run?: string | null };

const XHS_HOSTS = new Set(["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com"]);

function parseXhsUrls(value: string) {
  const valid: string[] = [];
  let invalid = 0;
  const unique = [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
  for (const raw of unique) {
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || !XHS_HOSTS.has(url.hostname.toLowerCase())) invalid += 1;
      else valid.push(url.toString());
    } catch {
      invalid += 1;
    }
  }
  return { valid: valid.slice(0, 20), invalid, overflow: Math.max(0, valid.length - 20) };
}

function parseXhsProfileUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !["xiaohongshu.com", "www.xiaohongshu.com"].includes(url.hostname.toLowerCase())) return null;
    return /^\/user\/profile\/[a-zA-Z0-9_-]{8,80}\/?$/.test(url.pathname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function Workbench({ user, signInHref, signOutHref }: { user: User; signInHref: string; signOutHref: string }) {
  const [section, setSection] = useState<Section>("collect");
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<"profile" | "links">("links");
  const [profileUrl, setProfileUrl] = useState("");
  const [links, setLinks] = useState("");
  const [count, setCount] = useState(20);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [resultCount, setResultCount] = useState(0);
  const [resultPosts, setResultPosts] = useState<ResultPost[]>([]);
  const [resultPersisted, setResultPersisted] = useState(false);
  const [qaWarnings, setQaWarnings] = useState<string[]>([]);
  const [browserState, setBrowserState] = useState<BrowserState>("idle");
  const [browserLiveUrl, setBrowserLiveUrl] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [dashboardRows, setDashboardRows] = useState<DashboardRow[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<"checking" | "ok" | "error">("checking");
  const [metric, setMetric] = useState<"likes" | "comments" | "saves">("likes");
  const [toast, setToast] = useState("");

  const maxValue = useMemo(() => Math.max(1, ...dashboardRows.map((row) => row[metric])), [dashboardRows, metric]);
  const parsedUrls = useMemo(() => parseXhsUrls(links), [links]);
  const totalInteractions = useMemo(() => dashboardRows.reduce((sum, row) => sum + row.likes + row.comments + row.saves, 0), [dashboardRows]);
  const totalSaves = useMemo(() => dashboardRows.reduce((sum, row) => sum + row.saves, 0), [dashboardRows]);

  useEffect(() => {
    const key = "guru-agent-browser-session";
    const existing = window.localStorage.getItem(key);
    const id = existing || crypto.randomUUID();
    if (!existing) window.localStorage.setItem(key, id);
    setConversationId(id);
  }, []);

  useEffect(() => {
    void fetch("/api/health")
      .then((response) => {
        if (!response.ok) throw new Error("health check failed");
        setServiceStatus("ok");
      })
      .catch(() => setServiceStatus("error"));
  }, []);

  useEffect(() => {
    if (section !== "dashboard") return;
    setDashboardLoading(true);
    setDashboardError("");
    void fetch("/api/dashboard").then(async (response) => {
      const data = await response.json() as { snapshots?: Array<{ title: string; captured_at?: string; likes: number; comments: number; saves: number }>; error?: string };
      if (!response.ok) throw new Error(data.error || "数据看板加载失败");
      const snapshots = data.snapshots || [];
      setDashboardRows(snapshots.slice(0, 12).map((row, index) => ({
        title: row.title,
        date: row.captured_at ? new Date(row.captured_at).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : "--",
        likes: row.likes,
        comments: row.comments,
        saves: row.saves,
        delta: index === snapshots.length - 1 ? 0 : Math.max(0, row.likes - (snapshots[index + 1]?.likes || 0)),
      })));
    }).catch((error) => setDashboardError(error instanceof Error ? error.message : "数据看板加载失败")).finally(() => setDashboardLoading(false));
  }, [section]);

  useEffect(() => {
    if (section !== "automation") return;
    setSchedulesLoading(true);
    void fetch("/api/schedules").then(async (response) => {
      const data = await response.json() as { schedules?: Schedule[]; error?: string };
      if (!response.ok) throw new Error(data.error || "自动化配置加载失败");
      setSchedules(data.schedules || []);
    }).catch((error) => showToast(error instanceof Error ? error.message : "自动化配置加载失败")).finally(() => setSchedulesLoading(false));
  }, [section]);

  async function callBrowserAgent(action: "start" | "status" | "collect", extra: Record<string, unknown> = {}) {
    if (!conversationId) throw new Error("浏览器会话仍在初始化，请稍后再试");
    const response = await fetch("/scraper-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "makers-conversation-id": conversationId },
      body: JSON.stringify({ action, ...extra }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Agent Browser 请求失败");
    return result;
  }

  async function startAuthorization() {
    setBrowserState("opening");
    setBrowserLiveUrl("");
    try {
      const result = await callBrowserAgent("start") as { live_url?: string };
      if (!result.live_url) throw new Error("Agent Browser 未返回可访问的登录窗口地址");
      setBrowserLiveUrl(result.live_url);
      setBrowserState("authorization-required");
    } catch (error) {
      setBrowserState("error");
      showToast(error instanceof Error ? error.message : "无法启动授权窗口");
    }
  }

  async function confirmAuthorization() {
    setBrowserState("checking");
    try {
      const result = await callBrowserAgent("status") as { status?: string };
      if (result.status !== "authenticated") throw new Error("尚未检测到已登录的小红书账号");
      setBrowserState("ready");
      showToast("已验证小红书登录状态；采集时会再次复核");
    } catch (error) {
      setBrowserState("error");
      showToast(error instanceof Error ? error.message : "会话检查失败");
    }
  }

  async function runTask() {
    setRunning(true);
    setDone(false);
    setQaWarnings([]);
    try {
      if (mode === "links" && parsedUrls.invalid) throw new Error(`有 ${parsedUrls.invalid} 条链接格式或域名不正确`);
      if (mode === "links" && parsedUrls.overflow) throw new Error("单次真实采集最多支持 20 条链接");
      if (mode === "links" && !parsedUrls.valid.length) throw new Error("请至少填写 1 条有效的小红书帖子链接");
      const validProfileUrl = mode === "profile" ? parseXhsProfileUrl(profileUrl) : null;
      if (mode === "profile" && !validProfileUrl) throw new Error("请填写有效的小红书账号主页链接");
      if (browserState !== "ready") throw new Error("请先返回第一步完成 Agent Browser 登录验证");
      const requestedUrls = parsedUrls.valid;
      const agentResult = await callBrowserAgent("collect", {
        urls: mode === "links" ? requestedUrls.slice(0, Math.min(count, 20)) : undefined,
        profile_url: mode === "profile" ? validProfileUrl : undefined,
        limit: Math.min(count, mode === "links" ? 20 : 50),
      }) as { count?: number; attestation?: { payload: string; signature: string } };
      if (!agentResult.attestation || !agentResult.count) throw new Error("Agent Browser 未返回签名的可验证数据");
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attestation: agentResult.attestation }),
      });
      const result = await response.json() as { count?: number; persisted?: boolean; error?: string; posts?: ResultPost[]; qa?: { warnings?: string[]; rejected?: string[] } };
      if (!response.ok) throw new Error(result.error || "采集任务失败");
      setResultCount(result.count ?? 0);
      setResultPosts(result.posts || []);
      setResultPersisted(Boolean(result.persisted));
      setQaWarnings([...(result.qa?.warnings || []), ...(result.qa?.rejected || [])]);
      setDone(true);
      showToast(result.persisted ? "真实数据已验证并同步到云端" : "真实数据已验证；访客模式未写入云端");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "采集任务失败");
    } finally {
      setRunning(false);
    }
  }

  function downloadBlob(content: BlobPart, type: string, extension: string) {
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(new Blob([content], { type }));
    anchor.download = `guru-xhs-${new Date().toISOString().slice(0, 10)}.${extension}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  }

  function exportCsv() {
    if (!resultPosts.length) return showToast("暂无可导出的结果");
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [["标题", "作者", "正文", "发布时间", "标签", "链接", "点赞", "评论", "收藏", "采集时间", "来源", "校验状态"], ...resultPosts.map((post) => [post.title, post.author, post.content, post.publishedAt, post.tags.join(" "), post.url, post.likes, post.comments, post.saves, post.capturedAt, post.source, post.verification])];
    const csv = `\uFEFF${rows.map((row) => row.map(quote).join(",")).join("\n")}`;
    downloadBlob(csv, "text/csv;charset=utf-8", "csv");
  }

  function exportMarkdown() {
    if (!resultPosts.length) return showToast("暂无可导出的结果");
    const escape = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
    const header = "| 标题 | 作者 | 发布时间 | 点赞 | 评论 | 收藏 | 来源链接 | 采集时间 |\n|---|---|---|---:|---:|---:|---|---|";
    const rows = resultPosts.map((post) => `| ${escape(post.title)} | ${escape(post.author || "")} | ${escape(post.publishedAt || "")} | ${post.likes} | ${post.comments} | ${post.saves} | ${post.url} | ${post.capturedAt} |`);
    const details = resultPosts.map((post, index) => `\n## ${index + 1}. ${post.title}\n\n- 作者：${post.author || "未提取"}\n- 标签：${post.tags.join("、") || "未提取"}\n- 原始链接：${post.url}\n- 采集时间：${post.capturedAt}\n- 来源：Agent Browser（已校验 canonical URL）\n\n${post.content || "正文未提取"}`).join("\n");
    downloadBlob(`# 小红书采集结果\n\n${header}\n${rows.join("\n")}\n${details}\n`, "text/markdown;charset=utf-8", "md");
  }

  async function exportExcel() {
    if (!resultPosts.length) return showToast("暂无可导出的结果");
    const { default: writeExcelFile } = await import("write-excel-file/browser");
    const header = ["标题", "作者", "正文", "发布时间", "标签", "链接", "点赞", "评论", "收藏", "采集时间", "来源", "校验状态"].map((value) => ({ value, fontWeight: "bold" as const, backgroundColor: "#DFF4EC" }));
    const rows = resultPosts.map((post) => [post.title, post.author || "", post.content || "", post.publishedAt || "", post.tags.join(" "), post.url, post.likes, post.comments, post.saves, post.capturedAt, post.source, post.verification]);
    const blob = await writeExcelFile([header, ...rows], { columns: [{ width: 38 }, { width: 18 }, { width: 60 }, { width: 22 }, { width: 28 }, { width: 55 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 24 }, { width: 18 }, { width: 14 }] }).toBlob();
    downloadBlob(blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx");
  }

  async function createSchedule() {
    if (!user) return showToast("请先登录后创建自动化配置");
    try {
      const response = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "每日采集配置", frequency: "daily", scope: "all", active: false }),
      });
      const data = await response.json() as { schedule?: Schedule; error?: string };
      if (!response.ok || !data.schedule) throw new Error(data.error || "创建失败");
      setSchedules((current) => [data.schedule!, ...current]);
      showToast("已保存自动化配置；定时执行器尚未启用");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "创建失败");
    }
  }

  async function toggleSchedule(id: string, active: boolean) {
    try {
      const response = await fetch("/api/schedules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active }),
      });
      const data = await response.json() as { schedule?: Schedule; error?: string };
      if (!response.ok || !data.schedule) throw new Error(data.error || "更新失败");
      setSchedules((current) => current.map((item) => item.id === id ? data.schedule! : item));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "更新失败");
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><span /><span /><span /></div>
          <div><strong>采集台</strong><small>SOCIAL PULSE</small></div>
        </div>
        <nav aria-label="主要功能">
          <NavItem active={section === "collect"} icon="⌁" label="数据采集" onClick={() => setSection("collect")} />
          <NavItem active={section === "dashboard"} icon="⌗" label="数据看板" onClick={() => setSection("dashboard")} />
          <NavItem active={section === "automation"} icon="↻" label="自动化" onClick={() => setSection("automation")} />
        </nav>
        <div className="sidebar-bottom">
          <button className="help-button" onClick={() => showToast("使用帮助将在下一版本开放")}>? <span>使用帮助</span></button>
          <div className="user-card">
            <div className="avatar">{user?.name?.slice(0, 1).toUpperCase() || "访"}</div>
            <div className="user-info">
              <strong>{user?.name || "访客模式"}</strong>
              <span>{user ? "数据已跨设备同步" : "登录后同步数据"}</span>
            </div>
            <a className="text-link" href={user ? signOutHref : signInHref} onClick={(event) => { event.preventDefault(); window.location.assign(browserInternalUrl(user ? signOutHref : signInHref)); }}>{user ? "退出" : "登录"}</a>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <div className="eyebrow">PHASE 1 · 小红书</div>
            <h1>{section === "collect" ? "新建采集任务" : section === "dashboard" ? "数据看板" : "自动化任务"}</h1>
            <p>{section === "collect" ? "只接收经 Agent Browser 验证的真实结果，可导出 Markdown、Excel 与 CSV。" : section === "dashboard" ? "展示账号已保存、带来源证明的真实采集快照。" : "保存自动化配置；定时执行器未接入前不会显示假任务。"}</p>
          </div>
          <div className="top-actions">
            <span className={`status-pill ${serviceStatus === "error" ? "error" : ""}`}><i /> {serviceStatus === "checking" ? "正在检查服务" : serviceStatus === "ok" ? "服务正常" : "服务异常"}</span>
            <button className="icon-button" aria-label="通知" onClick={() => showToast("暂无新通知")}>●</button>
          </div>
        </header>

        {section === "collect" && (
          <div className="content-grid collect-grid">
            <section className="panel main-panel">
              <div className="stepper" aria-label="任务步骤">
                {[1, 2, 3].map((n) => (
                  <button key={n} className={step === n ? "step active" : step > n ? "step complete" : "step"} disabled={n > step} onClick={() => n <= step && setStep(n)}>
                    <b>{step > n ? "✓" : n}</b><span>{n === 1 ? "选择平台" : n === 2 ? "设定目标" : "采集规则"}</span>
                  </button>
                ))}
              </div>

              {step === 1 && <StepOne browserState={browserState} browserLiveUrl={browserLiveUrl} onStartAuthorization={startAuthorization} onConfirmAuthorization={confirmAuthorization} onNext={() => setStep(2)} />}
              {step === 2 && (
                <div className="form-area">
                  <div className="section-title"><span>02</span><div><h2>设定真实采集目标</h2><p>使用账号主页链接批量发现帖子，或直接指定帖子链接。</p></div></div>
                  <div className="segmented">
                    <button className={mode === "profile" ? "active" : ""} onClick={() => setMode("profile")}>按账号主页</button>
                    <button className={mode === "links" ? "active" : ""} onClick={() => setMode("links")}>按链接采集</button>
                  </div>
                  {mode === "profile" ? (
                    <label className="field"><span>小红书账号主页链接</span><input value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} placeholder="https://www.xiaohongshu.com/user/profile/..." /><small className={profileUrl && !parseXhsProfileUrl(profileUrl) ? "field-error" : ""}>必须是公开可访问的 user/profile 链接；不再接受账号名称生成演示数据。</small></label>
                  ) : (
                    <label className="field"><span>帖子链接</span><textarea value={links} onChange={(e) => setLinks(e.target.value)} placeholder="每行粘贴一个小红书链接" /><small className={parsedUrls.invalid || parsedUrls.overflow ? "field-error" : ""}>最多 20 条，自动去重；仅支持 xiaohongshu.com 与 xhslink.com。{parsedUrls.invalid ? ` 当前有 ${parsedUrls.invalid} 条无效链接。` : ""}{parsedUrls.overflow ? " 已超过 20 条。" : ""}</small></label>
                  )}
                  <div className="form-footer"><button className="secondary" onClick={() => setStep(1)}>上一步</button><button className="primary" disabled={mode === "links" ? (!parsedUrls.valid.length || Boolean(parsedUrls.invalid) || Boolean(parsedUrls.overflow)) : !parseXhsProfileUrl(profileUrl)} onClick={() => setStep(3)}>继续设置规则 <span>→</span></button></div>
                </div>
              )}
              {step === 3 && (
                <div className="form-area">
                  <div className="section-title"><span>03</span><div><h2>设定采集规则</h2><p>选择数量并确认任务，系统将自动完成质检与归档。</p></div></div>
                  <label className="field"><span>最多采集数量</span><div className="count-control"><button onClick={() => setCount(Math.max(1, count - 5))}>−</button><input type="number" min="1" max={mode === "links" ? 20 : 50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(mode === "links" ? 20 : 50, Number(e.target.value) || 1)))} /><button onClick={() => setCount(Math.min(mode === "links" ? 20 : 50, count + 5))}>＋</button></div><small>{mode === "links" ? "单次最多处理 20 条指定链接。" : "从账号主页发现帖子后，单次最多验证 50 条。"}</small></label>
                  <div className="summary-box"><span>任务摘要</span><b>小红书 · {mode === "profile" ? "账号主页" : `${parsedUrls.valid.length} 条有效链接`} · 最多 {mode === "links" ? Math.min(count, parsedUrls.valid.length) : count} 篇 · 仅真实模式</b></div>
                  {done && <div className="success-box"><b>✓ 来源校验通过</b><span>{resultCount} 条数据具有 canonical URL 与采集时间；{resultPersisted ? "已保存到账号云端。" : "访客模式未写入云端。"}</span><div className="export-actions"><button onClick={exportMarkdown}>导出 Markdown</button><button onClick={() => void exportExcel()}>导出 Excel</button><button onClick={exportCsv}>导出 CSV</button></div></div>}
                  {done && qaWarnings.length > 0 && <div className="warning-box"><b>字段缺失或被拒绝的结果</b><ul>{qaWarnings.slice(0, 8).map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
                  {done && resultPosts.length > 0 && <div className="result-audit"><div className="panel-heading"><div><span className="kicker">SOURCE AUDIT</span><h3>结果与来源证明</h3></div></div>{resultPosts.map((post) => <article key={post.noteId}><div><b>{post.title}</b><span>{post.author || "作者未提取"} · {post.publishedAt || "发布时间未提取"}</span></div><div><span>❤ {post.likes.toLocaleString()}　评论 {post.comments.toLocaleString()}　收藏 {post.saves.toLocaleString()}</span><a href={post.url} target="_blank" rel="noreferrer">核对原帖 ↗</a></div><small>采集时间 {new Date(post.capturedAt).toLocaleString("zh-CN")} · Agent Browser · canonical URL 已校验</small></article>)}</div>}
                  <div className="form-footer"><button className="secondary" onClick={() => setStep(2)}>上一步</button><button className="primary" disabled={running || browserState !== "ready"} onClick={runTask}>{running ? "正在采集并核验…" : browserState === "ready" ? "运行真实采集" : "请先验证浏览器登录"} <span>{running ? "" : "→"}</span></button></div>
                </div>
              )}
            </section>
            <aside className="side-column">
              <InfoCard title="可核验采集流程" tone="mint" items={["验证浏览器登录状态", "读取账号主页或指定帖子", "校验 canonical URL 与错误页", "Markdown / Excel / CSV"]} />
              <div className="mini-card"><div><span>本次结果</span><b>{resultCount}</b><small>篇已结构化帖子</small></div><em>{done ? "已完成" : "等待任务"}</em></div>
              <div className="notice-card"><b>关于真实采集</b><p>登录由 EdgeOne 隔离浏览器窗口完成，系统不接收密码或验证码。当前真实模式只处理你提供的帖子链接，并遵守平台规则。</p></div>
            </aside>
          </div>
        )}

        {section === "dashboard" && (
          <div className="dashboard-layout">
            <div className="metrics-row">
              <MetricCard label="已存快照" value={String(dashboardRows.length)} delta={user ? "当前账号" : "需要登录"} />
              <MetricCard label="累计互动" value={totalInteractions.toLocaleString()} delta="点赞+评论+收藏" />
              <MetricCard label="收藏占比" value={totalInteractions ? `${((totalSaves / totalInteractions) * 100).toFixed(1)}%` : "0%"} delta="当前快照" />
              <MetricCard label="数据来源" value={dashboardRows.length ? "真实" : "—"} delta="无演示填充" />
            </div>
            <section className="panel chart-panel">
              <div className="panel-heading"><div><span className="kicker">CONTENT PERFORMANCE</span><h2>内容表现趋势</h2></div><div className="segmented compact">{(["likes", "comments", "saves"] as const).map((key) => <button key={key} className={metric === key ? "active" : ""} onClick={() => setMetric(key)}>{key === "likes" ? "点赞" : key === "comments" ? "评论" : "收藏"}</button>)}</div></div>
              {dashboardLoading ? <EmptyState text="正在读取数据…" /> : dashboardError ? <EmptyState text={dashboardError} /> : !user ? <EmptyState text="请先登录，登录后这里会显示跨设备保存的真实数据。" action="登录" onAction={() => window.location.assign(browserInternalUrl(signInHref))} /> : !dashboardRows.length ? <EmptyState text="暂无真实快照，请先完成一次采集任务。" action="开始采集" onAction={() => setSection("collect")} /> : <div className="bar-chart" aria-label="内容数据对比图">{dashboardRows.map((row, index) => <div className="bar-row" key={`${row.title}-${index}`}><span>{row.title}</span><div><i style={{ width: `${Math.max(12, (row[metric] / maxValue) * 100)}%` }} /></div><b>{row[metric].toLocaleString()}</b></div>)}</div>}
            </section>
            <section className="panel table-panel">
              <div className="panel-heading"><div><span className="kicker">SAVED SNAPSHOTS</span><h2>真实采集快照</h2></div><button className="secondary" onClick={() => setSection("collect")}>＋ 新建采集</button></div>
              {dashboardRows.length ? <div className="data-table">{dashboardRows.map((row, index) => <div className="data-row" key={`${row.title}-${index}`}><span className="post-dot">小红书</span><strong>{row.title}</strong><span>{row.date}</span><span>❤ {row.likes.toLocaleString()}</span><em>{row.delta ? `▲ ${row.delta}` : "—"}</em><span /></div>)}</div> : <EmptyState text="暂无已保存快照。" />}
            </section>
          </div>
        )}

        {section === "automation" && (
          <div className="automation-layout">
            <section className="panel automation-hero">
              <div><span className="kicker">CONFIGURATION BETA</span><h2>保存自动化任务配置</h2><p>当前版本可以保存与启停配置；EdgeOne 定时执行器尚未接入，不会虚假显示“下次运行”。</p></div>
              <button className="primary" onClick={createSchedule}>＋ 新建配置</button>
            </section>
            {schedulesLoading ? <section className="panel"><EmptyState text="正在读取自动化配置…" /></section> : !user ? <section className="panel"><EmptyState text="请先登录后管理自动化配置。" action="登录" onAction={() => window.location.assign(browserInternalUrl(signInHref))} /></section> : schedules.length ? <div className="schedule-list">{schedules.map((schedule) => <ScheduleCard key={schedule.id} schedule={schedule} onToggle={toggleSchedule} />)}</div> : <section className="panel"><EmptyState text="暂无自动化配置。当前版本不会用固定假任务填充此区域。" action="新建配置" onAction={createSchedule} /></section>}
          </div>
        )}
      </section>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function NavItem({ active, icon, label, badge, onClick }: { active: boolean; icon: string; label: string; badge?: string; onClick: () => void }) {
  return <button className={active ? "nav-item active" : "nav-item"} onClick={onClick}><span className="nav-icon">{icon}</span><span>{label}</span>{badge && <em>{badge}</em>}</button>;
}

function StepOne({ browserState, browserLiveUrl, onStartAuthorization, onConfirmAuthorization, onNext }: { browserState: BrowserState; browserLiveUrl: string; onStartAuthorization: () => void; onConfirmAuthorization: () => void; onNext: () => void }) {
  const statusText = browserState === "ready" ? "已检测到登录账号；采集时会再次验证" : browserState === "error" ? "会话或登录验证失败，请重新启动" : "在隔离浏览器中自行登录，本站不接收账号密码";
  return <div className="form-area"><div className="section-title"><span>01</span><div><h2>连接小红书账号</h2><p>必须由 Agent Browser 返回真实登录证据，不能手动跳过。</p></div></div><button className="platform-card selected"><span className="xhs-logo">小</span><div><b>小红书</b><small>Xiaohongshu · EdgeOne Agent Browser</small></div><i>{browserState === "ready" ? "✓" : "·"}</i></button><div className={`browser-auth ${browserState === "error" ? "has-error" : ""}`}><div><b>个人账号浏览器会话</b><small>{statusText}</small></div>{browserState === "idle" || browserState === "error" ? <button className="secondary" onClick={onStartAuthorization}>{browserState === "error" ? "重新启动授权窗口" : "启动授权窗口"}</button> : browserState === "opening" ? <button className="secondary" disabled>正在启动…</button> : browserState === "authorization-required" ? <span className="auth-actions">{browserLiveUrl && <a className="secondary" href={browserLiveUrl} target="_blank" rel="noreferrer">打开登录窗口</a>}<button className="primary" onClick={onConfirmAuthorization}>验证登录状态</button></span> : browserState === "checking" ? <button className="secondary" disabled>正在验证登录…</button> : <span className="auth-ready">✓ 已验证登录</span>}</div><div className="truth-note"><b>验收规则</b><span>登录窗口不可访问、未登录、帖子不存在或页面字段不足时，任务必须失败并显示原因，不会生成“成功”数据。</span></div><div className="coming-soon"><span>抖音</span><span>微博</span><small>将在后续阶段开放</small></div><div className="form-footer align-right"><button className="primary" disabled={browserState !== "ready"} onClick={onNext}>下一步：设定目标 <span>→</span></button></div></div>;
}

function InfoCard({ title, items }: { title: string; tone: string; items: string[] }) {
  return <div className="info-card"><span className="kicker">HOW IT WORKS</span><h3>{title}</h3><ol>{items.map((item, index) => <li key={item}><b>{index + 1}</b><span>{item}</span></li>)}</ol></div>;
}

function MetricCard({ label, value, delta }: { label: string; value: string; delta: string }) {
  return <div className="metric-card"><span>{label}</span><b>{value}</b><em>{delta}</em></div>;
}

function ScheduleCard({ schedule, onToggle }: { schedule: Schedule; onToggle: (id: string, active: boolean) => void }) {
  return <article className="schedule-card"><div className={schedule.active ? "schedule-icon active" : "schedule-icon"}>↻</div><div className="schedule-main"><b>{schedule.name}</b><span>{schedule.frequency} · {schedule.scope}</span></div><div className="schedule-next"><small>执行状态</small><strong>执行器未接入</strong></div><button className={schedule.active ? "toggle on" : "toggle"} onClick={() => onToggle(schedule.id, !schedule.active)} aria-label={schedule.active ? "暂停配置" : "启用配置"}><i /></button><span /></article>;
}

function EmptyState({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><p>{text}</p>{action && onAction && <button className="secondary" onClick={onAction}>{action}</button>}</div>;
}
