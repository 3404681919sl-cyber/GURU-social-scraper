import { getCurrentUser } from "@/lib/auth";

type VerifiedPost = {
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

type SignedPayload = {
  version: number;
  taskId: string;
  issuedAt: string;
  mode: "links" | "profile";
  target: string;
  requestedCount: number;
  posts: Array<Record<string, unknown>>;
  warnings: string[];
};

const XHS_POST_HOSTS = new Set(["xiaohongshu.com", "www.xiaohongshu.com"]);

function canonicalPostId(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !XHS_POST_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f0-9]{24})\/?$/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

function finiteCount(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

function cleanOptional(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function verifyAttestation(attestation: { payload?: unknown; signature?: unknown }): Promise<SignedPayload> {
  const secret = process.env.SCRAPE_SIGNING_SECRET;
  if (!secret || secret.length < 32) throw new Error("SCRAPE_SIGNING_SECRET 未配置或长度不足 32 位");
  if (typeof attestation.payload !== "string" || typeof attestation.signature !== "string") throw new Error("采集证明格式无效");
  const payloadBytes = fromBase64Url(attestation.payload);
  const signature = fromBase64Url(attestation.signature);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, signature, payloadBytes);
  if (!valid) throw new Error("采集证明签名无效，结果可能被篡改");
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as SignedPayload;
  const issuedAt = Date.parse(payload.issuedAt);
  if (!Number.isFinite(issuedAt) || issuedAt > Date.now() + 60_000 || Date.now() - issuedAt > 15 * 60_000) throw new Error("采集证明已过期，请重新运行任务");
  if (payload.version !== 1 || !/^[0-9a-f-]{36}$/i.test(payload.taskId) || !["links", "profile"].includes(payload.mode) || !Array.isArray(payload.posts)) throw new Error("采集证明内容无效");
  return payload;
}

function verifyPost(raw: Record<string, unknown>): { post?: VerifiedPost; error?: string; warnings: string[] } {
  const url = cleanOptional(raw.url, 2000);
  const noteId = url ? canonicalPostId(url) : null;
  const title = cleanOptional(raw.title, 500);
  if (!url || !noteId) return { error: "采集结果没有可验证的小红书 canonical 帖子地址", warnings: [] };
  if (!title || /^(未命名帖子|小红书|site unavailable)$/i.test(title)) return { error: `${url}: 页面标题无效`, warnings: [] };

  const capturedAtCandidate = cleanOptional(raw.capturedAt, 80);
  const capturedAt = capturedAtCandidate && !Number.isNaN(Date.parse(capturedAtCandidate))
    ? new Date(capturedAtCandidate).toISOString()
    : new Date().toISOString();
  const author = cleanOptional(raw.author, 200);
  const content = cleanOptional(raw.content, 10000);
  const publishedAtCandidate = cleanOptional(raw.publishedAt, 80);
  const publishedAt = publishedAtCandidate && !Number.isNaN(Date.parse(publishedAtCandidate))
    ? new Date(publishedAtCandidate).toISOString()
    : publishedAtCandidate;
  const tags = Array.isArray(raw.tags)
    ? [...new Set(raw.tags.map((tag) => cleanOptional(tag, 80)).filter((tag): tag is string => Boolean(tag)))].slice(0, 30)
    : [];
  const warnings: string[] = [];
  if (!author) warnings.push(`${url}: 未提取到作者`);
  if (!content) warnings.push(`${url}: 未提取到正文`);
  if (!publishedAt) warnings.push(`${url}: 未提取到发布时间`);

  return {
    warnings,
    post: {
      noteId,
      title,
      url,
      author,
      content,
      publishedAt,
      tags,
      likes: finiteCount(raw.likes),
      comments: finiteCount(raw.comments),
      saves: finiteCount(raw.saves),
      capturedAt,
      source: "agent-browser",
      verification: "verified",
    },
  };
}

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    attestation?: { payload?: unknown; signature?: unknown };
  };
  if (!payload.attestation) return Response.json({ error: "缺少 Agent Browser 签名的采集证明" }, { status: 422 });
  let signed: SignedPayload;
  try {
    signed = await verifyAttestation(payload.attestation);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "采集证明校验失败" }, { status: 422 });
  }
  if (!signed.posts.length) {
    return Response.json({ error: "Agent Browser 没有返回任何结果；任务不会被标记为成功" }, { status: 422 });
  }

  const warnings = [...new Set((signed.warnings ?? []).map(String))];
  const posts: VerifiedPost[] = [];
  const rejected: string[] = [];
  for (const raw of signed.posts.slice(0, 50)) {
    const checked = verifyPost(raw);
    warnings.push(...checked.warnings);
    if (checked.post) posts.push(checked.post);
    else if (checked.error) rejected.push(checked.error);
  }
  if (!posts.length) {
    return Response.json({ error: rejected[0] || "没有通过来源校验的数据", qa: { status: "FAIL", rejected, warnings } }, { status: 422 });
  }

  const { supabase, user } = await getCurrentUser();
  const taskId = signed.taskId;
  const requestedCount = Math.max(1, Math.min(50, Number(signed.requestedCount) || posts.length));

  if (user && supabase) {
    const { error: taskError } = await supabase.from("scrape_tasks").insert({
      id: taskId,
      user_id: user.id,
      platform: "xhs",
      mode: signed.mode,
      target: String(signed.target || posts.map((post) => post.url).join("\n")).slice(0, 20000),
      requested_count: requestedCount,
      result_count: posts.length,
      qa_status: rejected.length ? "PASS_WITH_WARNINGS" : "PASS",
      status: "completed",
    });
    if (taskError) return Response.json({ error: `任务保存失败：${taskError.message}` }, { status: 500 });

    const { error: snapshotError } = await supabase.from("snapshots").insert(posts.map((post) => ({
      user_id: user.id,
      task_id: taskId,
      note_id: post.noteId,
      title: post.title,
      url: post.url,
      author: post.author,
      content: post.content,
      published_at: post.publishedAt,
      tags: post.tags,
      likes: post.likes,
      comments: post.comments,
      saves: post.saves,
      source_kind: post.source,
      verification_status: post.verification,
      captured_at: post.capturedAt,
    })));
    if (snapshotError) return Response.json({ error: `快照保存失败：${snapshotError.message}` }, { status: 500 });
  }

  return Response.json({
    task_id: taskId,
    persisted: Boolean(user),
    count: posts.length,
    posts,
    qa: { status: rejected.length ? "PASS_WITH_WARNINGS" : "PASS", checked: posts.length, rejected, warnings: [...new Set(warnings)] },
  }, { status: 201 });
}
