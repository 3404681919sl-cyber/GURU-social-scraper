type ScrapePost = {
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
};

type AgentBrowser = {
  liveUrl: string;
  goto(url: string): Promise<unknown>;
  evaluate(script: string): Promise<unknown>;
};

type SandboxInfo = { instanceId?: string; expiresAt?: string };
type EdgeOneSandbox = {
  browser?: AgentBrowser;
  getInfo?(): SandboxInfo;
  extendTimeout?(seconds: number): Promise<SandboxInfo>;
};
type EdgeOneAgentContext = {
  request?: { body?: Record<string, unknown> };
  env?: Record<string, string | undefined>;
  sandbox?: EdgeOneSandbox;
};

const JSON_HEADERS = { "Content-Type": "application/json; charset=UTF-8" };
const INPUT_HOSTS = new Set(["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com"]);
const CANONICAL_HOSTS = new Set(["xiaohongshu.com", "www.xiaohongshu.com"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function safeInputUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !INPUT_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeProfileUrl(raw: string) {
  const value = safeInputUrl(raw);
  if (!value) return null;
  const url = new URL(value);
  return CANONICAL_HOSTS.has(url.hostname.toLowerCase()) && /^\/user\/profile\/[a-zA-Z0-9_-]{8,80}\/?$/.test(url.pathname) ? url.toString() : null;
}

function parseResult<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function attest(payload: Record<string, unknown>, secret: string) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, payloadBytes));
  return { payload: base64Url(payloadBytes), signature: base64Url(signature) };
}

async function inspectSession(browser: AgentBrowser) {
  return parseResult<{ authenticated: boolean; url: string; title: string; reason: string }>(await browser.evaluate(`JSON.stringify((() => {
    const text = (document.body?.innerText || '').slice(0, 8000);
    const url = location.href;
    const onXhs = /(^|\\.)xiaohongshu\\.com$/i.test(location.hostname);
    const blocked = /登录后|登录即可|请先登录|扫码登录|验证码登录/.test(text);
    const profileLink = document.querySelector('a[href*="/user/profile/"]');
    const loginControl = [...document.querySelectorAll('button, a')].some((node) => /^(登录|立即登录)$/.test((node.textContent || '').trim()));
    const authenticated = Boolean(onXhs && profileLink && !blocked && !loginControl);
    return {
      authenticated,
      url,
      title: document.title,
      reason: authenticated ? 'profile-evidence' : !onXhs ? 'not-on-xiaohongshu' : blocked || loginControl ? 'login-required' : 'no-authentication-evidence'
    };
  })())`));
}

async function discoverProfilePosts(browser: AgentBrowser, profileUrl: string, limit: number) {
  await browser.goto(profileUrl);
  const state = await inspectSession(browser);
  if (!state.authenticated) throw new Error(`登录状态未验证：${state.reason}`);
  const links = new Set<string>();
  for (let pass = 0; pass < 4 && links.size < limit; pass += 1) {
    const found = parseResult<string[]>(await browser.evaluate(`JSON.stringify([...document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]')]
      .map((node) => node.href)
      .filter((href) => /^https:\/\/(?:www\\.)?xiaohongshu\\.com\/(?:explore|discovery\/item)\/[a-f0-9]{24}(?:[/?#]|$)/i.test(href)))`));
    found.forEach((href) => links.add(href));
    if (links.size >= limit) break;
    await browser.evaluate(`(async () => { window.scrollTo(0, document.body.scrollHeight); await new Promise((resolve) => setTimeout(resolve, 1200)); return true; })()`);
  }
  return [...links].slice(0, limit);
}

async function extractPost(browser: AgentBrowser, requestedUrl: string) {
  await browser.goto(requestedUrl);
  return parseResult<ScrapePost & { valid: boolean; error?: string; loginRequired?: boolean }>(await browser.evaluate(`JSON.stringify((() => {
    const text = document.body?.innerText || '';
    const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
    const canonicalMatch = canonical.match(/^https:\/\/(?:www\\.)?xiaohongshu\\.com\/(?:explore|discovery\/item)\/([a-f0-9]{24})(?:[/?#]|$)/i);
    const loginRequired = /登录后|登录即可|请先登录|扫码登录|验证码登录/.test(text.slice(0, 8000));
    const unavailable = /页面不存在|内容不存在|笔记已删除|内容已删除|Site Unavailable|Unable to access this site/i.test(text + ' ' + document.title);
    let structured = {};
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(node.textContent || '{}');
        const candidates = Array.isArray(parsed) ? parsed : parsed['@graph'] || [parsed];
        const article = candidates.find((item) => item && (item.articleBody || item.headline || item.datePublished));
        if (article) { structured = article; break; }
      } catch {}
    }
    const readCount = (labels) => {
      for (const label of labels) {
        const patterns = [new RegExp(label + '\\s*([0-9]+(?:\\.[0-9]+)?[万千wWkK]?)'), new RegExp('([0-9]+(?:\\.[0-9]+)?[万千wWkK]?)\\s*' + label)];
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (!match) continue;
          const value = parseFloat(match[1]);
          return /[万wW]/.test(match[1]) ? Math.round(value * 10000) : /[千kK]/.test(match[1]) ? Math.round(value * 1000) : Math.round(value);
        }
      }
      return 0;
    };
    const meta = (key) => document.querySelector('meta[property="' + key + '"]')?.content || document.querySelector('meta[name="' + key + '"]')?.content || '';
    const title = String(structured.headline || meta('og:title') || document.querySelector('#detail-title')?.textContent || document.querySelector('h1')?.textContent || document.title || '').trim();
    const content = String(structured.articleBody || meta('og:description') || meta('description') || document.querySelector('#detail-desc')?.textContent || '').trim();
    const authorNode = structured.author;
    const author = String((authorNode && (authorNode.name || authorNode[0]?.name)) || document.querySelector('.author-wrapper .name, .username, [class*="author"] [class*="name"]')?.textContent || '').trim();
    const publishedAt = String(structured.datePublished || document.querySelector('time')?.dateTime || document.querySelector('time')?.textContent || '').trim();
    const tags = [...new Set([...document.querySelectorAll('a[href*="search_result?keyword="], [class*="tag"]')]
      .map((node) => (node.textContent || '').trim()).filter((value) => value.startsWith('#') && value.length < 80))].slice(0, 30);
    const valid = Boolean(canonicalMatch && !loginRequired && !unavailable && title && text.length > 100);
    return {
      valid,
      error: loginRequired ? '页面要求登录' : unavailable ? '帖子不存在或已删除' : !canonicalMatch ? '没有得到可验证的 canonical 帖子地址' : !title ? '没有提取到标题' : text.length <= 100 ? '页面内容不完整' : undefined,
      loginRequired,
      noteId: canonicalMatch?.[1] || '',
      title,
      url: canonical,
      author: author || null,
      content: content || null,
      publishedAt: publishedAt || null,
      tags,
      likes: readCount(['点赞', '赞']),
      comments: readCount(['评论']),
      saves: readCount(['收藏']),
      capturedAt: new Date().toISOString()
    };
  })())`));
}

export async function onRequest(context: EdgeOneAgentContext) {
  const body = context.request?.body ?? {};
  const action = typeof body.action === "string" ? body.action : "status";
  const sandbox = context.sandbox;
  const browser = sandbox?.browser;
  if (!sandbox || !browser) return json({ error: "EdgeOne Agent Sandbox 浏览器尚未启用", code: "SANDBOX_UNAVAILABLE" }, 503);

  if (action === "start") {
    try {
      await sandbox.extendTimeout?.(1800);
      await browser.goto("https://www.xiaohongshu.com/explore");
      const info = sandbox.getInfo?.();
      return json({ status: "authorization-required", live_url: browser.liveUrl, expires_at: info?.expiresAt ?? null });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "授权浏览器启动失败", code: "BROWSER_START_FAILED" }, 503);
    }
  }

  if (action === "status") {
    try {
      const state = await inspectSession(browser);
      if (!state.authenticated) return json({ error: "尚未检测到已登录的小红书账号", code: "LOGIN_REQUIRED", state }, 401);
      return json({ status: "authenticated", state });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "登录状态检查失败", code: "STATUS_CHECK_FAILED" }, 503);
    }
  }

  if (action !== "collect") return json({ error: "不支持的 action" }, 400);

  try {
    const state = await inspectSession(browser);
    if (!state.authenticated) return json({ error: "真实采集前必须完成小红书登录验证", code: "LOGIN_REQUIRED", state }, 401);
    const limit = Math.max(1, Math.min(50, Number(body.limit) || 20));
    let urls = Array.isArray(body.urls)
      ? [...new Set(body.urls.map((item: unknown) => safeInputUrl(String(item))).filter((item): item is string => Boolean(item)))].slice(0, limit)
      : [];
    const profileUrl = typeof body.profile_url === "string" ? safeProfileUrl(body.profile_url) : null;
    if (!urls.length && profileUrl) urls = await discoverProfilePosts(browser, profileUrl, limit);
    if (!urls.length) return json({ error: profileUrl ? "账号主页中没有发现可采集的帖子链接" : "请提供有效的帖子链接或账号主页链接" }, 400);

    const posts: ScrapePost[] = [];
    const warnings: string[] = [];
    for (const url of urls) {
      try {
        const result = await extractPost(browser, url);
        if (!result.valid) {
          warnings.push(`${url}: ${result.error || "来源校验失败"}`);
          continue;
        }
        const { valid: _valid, error: _error, loginRequired: _loginRequired, ...post } = result;
        void _valid; void _error; void _loginRequired;
        posts.push(post);
      } catch (error) {
        warnings.push(`${url}: ${error instanceof Error ? error.message : "页面采集失败"}`);
      }
    }
    if (!posts.length) return json({ error: warnings[0] || "没有采集到可验证数据", code: "NO_VERIFIED_RESULTS", warnings }, 422);
    const signingSecret = context.env?.SCRAPE_SIGNING_SECRET;
    if (!signingSecret || signingSecret.length < 32) {
      return json({ error: "SCRAPE_SIGNING_SECRET 未配置或长度不足 32 位；拒绝返回不可验证结果", code: "ATTESTATION_NOT_CONFIGURED" }, 503);
    }
    const mode = profileUrl ? "profile" : "links";
    const signedPayload = {
      version: 1,
      taskId: crypto.randomUUID(),
      issuedAt: new Date().toISOString(),
      mode,
      target: profileUrl || urls.join("\n"),
      requestedCount: urls.length,
      posts,
      warnings,
    };
    return json({ status: "completed", count: posts.length, requested: urls.length, attestation: await attest(signedPayload, signingSecret) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "浏览器采集失败", code: "COLLECT_FAILED" }, 500);
  }
}
