import http from 'node:http';
import crypto from 'node:crypto';
import { initializeNooxy } from 'nooxy';

const PORT = Number(process.env.PORT ?? 3000);
const PAGE_ID = (process.env.PAGE_ID || '3070813acca0800da637f35bb4837b87').trim();
const NOTION_SUBDOMAIN = (process.env.NOTION_SUBDOMAIN || PAGE_ID).trim();
const SITE_NAME = process.env.SITE_NAME || 'My Notion Site';
// 留空则按"实际访问域名"动态代理（开箱即用）；填了则固定用于 SEO canonical。
const FIXED_DOMAIN = (process.env.DOMAIN || '').trim();

// —— 私有站点密码门（单密码，Cookie 门禁）——
const SITE_PASS = process.env.SITE_PASS || '';
const GATE_ENABLED = Boolean(SITE_PASS);
const AUTH_COOKIE = 'site_auth';
const AUTH_PATH = '/__auth';
// 每次容器启动随机生成服务端密钥，登录态随之失效（需重新输密码）；
// 这样 Cookie 值不泄露 SITE_PASS，也无法被离线伪造。
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const TOKEN = crypto.createHmac('sha256', SESSION_SECRET).update('authed').digest('hex');

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function hasValidCookie(req) {
  const c = parseCookies(req.headers.cookie)[AUTH_COOKIE];
  if (!c) return false;
  const a = Buffer.from(c);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function setAuthCookie(res) {
  const maxAge = 60 * 60 * 24 * 30; // 30 天
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE}=${TOKEN}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`
  );
}

const LOGIN_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>密码访问 · PhotoBook</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#f4f5f7; padding:20px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif; }
  .card { width:min(400px,92vw); background:#fff; border:1px solid #e6e9ee; border-radius:18px;
    box-shadow:0 10px 30px rgba(20,30,50,.08); padding:40px 36px; }
  .brand { color:#0b5fc4; font-size:30px; font-weight:800; letter-spacing:.5px; margin:0 0 8px; text-align:left; }
  .sub { color:#6b7785; font-size:15px; margin:0 0 28px; text-align:left; }
  .field { width:100%; padding:13px 14px; border:1px solid #d9dde3; border-radius:10px;
    font-size:15px; background:#fff; outline:none; transition:border-color .15s, box-shadow .15s; }
  .field:focus { border-color:#0b5fc4; box-shadow:0 0 0 3px rgba(11,95,196,.14); }
  .btn { margin-top:18px; width:100%; padding:13px; border:none; border-radius:10px; cursor:pointer;
    background:#0b5fc4; color:#fff; font-size:16px; font-weight:600; text-align:center; transition:background .15s; }
  .btn:hover { background:#084ea3; }
  .err { color:#e23b3b; font-size:13px; min-height:18px; margin-top:12px; text-align:left; }
  @media (max-width:480px) { .card { padding:32px 24px; } }
</style>
</head>
<body>
  <div class="card">
    <form method="POST" action="${AUTH_PATH}">
      <h1 class="brand">PhotoBook</h1>
      <p class="sub">请输入访问密码</p>
      <input class="field" type="password" name="password" placeholder="访问密码" autocomplete="current-password" autofocus>
      <button class="btn" type="submit">进入</button>
      <div class="err">__ERROR__</div>
    </form>
  </div>
</body>
</html>`;

function sendLogin(res, error) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store'); // 不缓存登录页
  res.end(LOGIN_HTML.replace('__ERROR__', error ? '密码错误，请重试' : ''));
}

async function readForm(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const params = new URLSearchParams(Buffer.concat(chunks).toString());
  return Object.fromEntries(params.entries());
}

// 按域名缓存 proxy 实例，避免每次请求重建。
const proxies = new Map();
function getProxy(domain) {
  if (!proxies.has(domain)) {
    const proxy = initializeNooxy({
      domain,
      notionDomain: `${NOTION_SUBDOMAIN}.notion.site`,
      siteName: SITE_NAME,
      slugToPage: { '/': PAGE_ID },
      // 不跑 `npx nooxy generate` 时，这些注入字段留空字符串，
      // 否则 nooxy 会把 undefined 字面量写进 <head>/<body>。
      customHeadCSS: `/* Custom page styling */
.notion-page-content {
  max-width: 900px;
  margin: 0 auto;
}
/* Dark mode support */
.dark .notion-page-content {
  background: #1a1a1a;
}
/* —— 主题复刻：draphy.org/wellthy（等宽终端风 + 精简 topbar）—— */
/* 1) 全局等宽字体：终端风格的核心 */
*{font-family:ui-monospace,"SF Mono","Monaco","Cascadia Code","Segoe UI Mono","Roboto Mono","Ubuntu Mono","Menlo","Consolas","Liberation Mono","DejaVu Sans Mono","Courier New",monospace!important}
/* 2) 恢复 Notion 原生顶部栏（nooxy 默认隐藏） */
html body div.notion-topbar{display:block!important}
html body div.notion-topbar-mobile{display:flex!important}
/* 3) topbar 只留面包屑 + 搜索，隐藏编辑/分享/更多等按钮 */
div.notion-topbar :is([data-popup-origin],[role="button"]):not(:has(svg.magnifyingGlass)):not([class*="breadcrumb"] *){display:none!important}
div.notion-topbar-mobile [role="button"][aria-label],div.notion-topbar-mobile [role="button"]:not([aria-haspopup]):not([aria-disabled]){display:none!important}
[role="menuitem"]:has(:is(svg.duplicate,svg.ellipsis)){display:none!important}
/* 4) 自定义 header（nooxy badge）与 topbar 并排横排 */
html body header:has(>[class*="nooxyBadge"]){display:flex!important;align-items:center!important}
html body header>[class*="nooxyBadge"]{flex:0 0 auto!important;order:1!important;padding-block:0!important;padding-inline:0 10px!important}
html body header>div[class*="notion-topbar"]{flex:1 1 0!important;width:auto!important;min-width:0!important}
/* 5) 隐藏 Notion 浮动杂物（帮助气泡/属性弹层等） */
div[style*="position: absolute; top: 4px;"]{display:none!important}
div[aria-label="Page properties"]+div{display:none!important}
div[role="menuitem"][tabindex="-1"]:has(>div>div>svg.link){display:none!important}`,
      customHeadJS: '',
      customBodyJS: `// 去掉 Notion 面包屑/链接自带的 ?pvs= 参数，让顶层 photobook 直接指向 https://photo.typenode.net/
// 只改写 DOM 链接显示层，不动任何服务端请求，不影响 Notion 的 SPA 路由与数据加载
(function () {
  function stripPvs(href) {
    if (!href || href.indexOf('pvs=') === -1) return href;
    return href.replace(/([?&])pvs=[^&#]*/g, '$1').replace(/[?&]$/, '');
  }
  function clean() {
    var links = document.querySelectorAll('a[href*="pvs="]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var h = a.getAttribute('href');
      var c = stripPvs(h);
      if (c !== h) a.setAttribute('href', c);
    }
  }
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    var run = function () { scheduled = false; clean(); };
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 300 });
    else setTimeout(run, 200);
  }
  clean();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
})();`,
      customHeader: '',
      seo: {
        indexing: false,
      },
    });
    proxies.set(domain, proxy);
  }
  return proxies.get(domain);
}

http
  .createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const path = reqUrl.pathname;

      // favicon 直接 204，避免无谓地返回登录页
      if (path === '/favicon.ico') {
        res.statusCode = 204;
        res.end();
        return;
      }

      // 1) 密码提交端点
      if (path === AUTH_PATH) {
        if (req.method === 'POST' && GATE_ENABLED) {
          const form = await readForm(req);
          if (form.password === SITE_PASS) {
            setAuthCookie(res);
            res.statusCode = 302;
            res.setHeader('Location', '/');
            res.end();
            return;
          }
          sendLogin(res, true);
          return;
        }
        // 已登录访问 /__auth，或非法请求 → 回首页
        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
        return;
      }

      // 2) 门禁：未登录一律拦在门外（内容绝不出服务器）
      if (GATE_ENABLED && !hasValidCookie(req)) {
        if (req.method === 'GET' || req.method === 'HEAD') {
          sendLogin(res, false);
        } else {
          res.statusCode = 403;
          res.end('Forbidden');
        }
        return;
      }

      // 3) 已放行：剥离我们的认证 Cookie，正常代理 Notion
      const host = req.headers.host || `localhost:${PORT}`;
      const url = `http://${host}${req.url}`;

      // Notion 通过 POST /api/v3/* 加载页面内容，必须转发 body，
      // Node 转发流时须带 duplex:'half'（新版 nooxy 官方示例已正确处理）。
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

      // 转发给 Notion 时只剥掉我们自己的 site_auth，保留浏览器带来的其它 Cookie。
      const fwdHeaders = { ...req.headers };
      const cookies = parseCookies(req.headers.cookie);
      delete cookies[AUTH_COOKIE];
      const remaining = Object.entries(cookies)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('; ');
      if (remaining) fwdHeaders.cookie = remaining;
      else delete fwdHeaders.cookie;

      const request = new Request(url, {
        method: req.method,
        headers: fwdHeaders,
        body: hasBody ? req : undefined,
        duplex: hasBody ? 'half' : undefined,
      });

      const proxy = getProxy(FIXED_DOMAIN || host);
      const response = await proxy(request);

      res.statusCode = response.status;

      // set-cookie 可能有多条，必须逐个写入，否则会丢 Cookie（影响 Notion 登录）。
      const setCookies =
        typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : response.headers.get('set-cookie')
            ? [response.headers.get('set-cookie')]
            : [];
      if (setCookies.length > 0) res.setHeader('set-cookie', setCookies);

      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value);
      });

      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error('Request handler error:', err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    }
  })
  .listen(PORT, () => {
    console.log(
      `Nooxy running on :${PORT} — page ${PAGE_ID}, domain ${FIXED_DOMAIN || '<request host>'}` +
        (GATE_ENABLED ? ' [password gate ON]' : ' [gate OFF, SITE_PASS empty]')
    );
  });
