import type { Creation, LicenseManifest } from "@remix-hub/core";

/**
 * Server-rendered public share page + OG card for an exported work. Rendering
 * on the server (not the SPA) lets external platforms (X, Facebook, KakaoTalk,
 * Slack, etc.) fetch rich link previews via Open Graph / Twitter Card meta.
 */

const ACTION_LABEL: Record<string, string> = {
  image: "이미지",
  video_recast: "영상",
  music: "음악",
  voice: "보이스",
  characterize: "캐릭터",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function shareTitle(manifest: LicenseManifest, creation: Creation | null): string {
  const action = ACTION_LABEL[creation?.action ?? ""] ?? "작품";
  return `${manifest.ip_name} 컨셉 ${action} · REMIX HUB`;
}

export function shareDescription(manifest: LicenseManifest): string {
  return `${manifest.license.scope} · 🤖 ${manifest.ai_label.text} · 라이선스 검증됨(REMIX HUB)`;
}

/** A 1200×630 branded OG card as SVG (no image pipeline needed). */
export function renderShareCard(manifest: LicenseManifest, creation: Creation | null): string {
  const action = ACTION_LABEL[creation?.action ?? ""] ?? "작품";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#16181f"/><stop offset="1" stop-color="#0e0f13"/>
    </linearGradient>
    <linearGradient id="acc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#23d6a0"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect x="64" y="64" width="84" height="84" rx="22" fill="url(#acc)"/>
  <text x="106" y="124" font-family="Arial" font-size="48" font-weight="800" fill="#fff" text-anchor="middle">R</text>
  <text x="172" y="110" font-family="Arial" font-size="36" font-weight="800" fill="#e7e9ee">REMIX HUB</text>
  <text x="172" y="142" font-family="Arial" font-size="20" fill="#9aa1b0">IP × AI 2차창작 커뮤니티</text>
  <text x="64" y="300" font-family="Arial" font-size="64" font-weight="800" fill="#e7e9ee">${esc(manifest.ip_name)}</text>
  <text x="64" y="372" font-family="Arial" font-size="40" fill="#b3a0ff">컨셉 ${esc(action)} · ${esc(manifest.license.scope)}</text>
  <rect x="64" y="470" width="430" height="56" rx="28" fill="rgba(35,214,160,0.15)"/>
  <text x="92" y="506" font-family="Arial" font-size="24" font-weight="700" fill="#23d6a0">🤖 ${esc(manifest.ai_label.text)}</text>
  <text x="64" y="586" font-family="Arial" font-size="20" fill="#6b7180">라이선스 해시 ${esc(manifest.manifest_hash.slice(0, 24))}…</text>
</svg>`;
}

export function renderSharePage(
  manifest: LicenseManifest,
  creation: Creation | null,
  opts: { baseUrl: string; exportId: string; appUrl: string },
): string {
  const title = shareTitle(manifest, creation);
  const desc = shareDescription(manifest);
  const shareUrl = `${opts.baseUrl}/share/${opts.exportId}`;
  const cardUrl = `${shareUrl}/card.svg`;
  const action = ACTION_LABEL[creation?.action ?? ""] ?? "작품";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${esc(shareUrl)}"/>
<meta property="og:image" content="${esc(cardUrl)}"/>
<meta property="og:site_name" content="REMIX HUB"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${esc(cardUrl)}"/>
<style>
  :root{--bg:#0e0f13;--panel:#16181f;--line:#2b2f3a;--txt:#e7e9ee;--mut:#9aa1b0;--acc:#7c5cff;--acc2:#23d6a0}
  *{box-sizing:border-box;margin:0;padding:0;font-family:system-ui,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}
  body{background:var(--bg);color:var(--txt);min-height:100vh;display:grid;place-items:center;padding:22px}
  .card{max-width:520px;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden}
  .cover{height:230px;background:linear-gradient(135deg,#2a2350,#1c3a44);display:grid;place-items:center;color:#6b7180;position:relative}
  .wm{position:absolute;right:10px;bottom:10px;font-size:11px;background:rgba(0,0,0,.55);padding:4px 8px;border-radius:6px;color:#cfd3dc}
  .body{padding:18px}
  h1{font-size:20px;font-weight:800}
  .scope{color:var(--mut);font-size:13px;margin-top:6px}
  .label{display:inline-block;margin-top:12px;background:rgba(35,214,160,.15);color:var(--acc2);font-weight:700;font-size:12px;padding:6px 11px;border-radius:999px}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
  a.btn,button.btn{border:1px solid var(--line);background:#23272f;color:var(--txt);border-radius:10px;padding:9px 13px;font-size:13px;font-weight:700;cursor:pointer;text-decoration:none}
  a.pri{background:linear-gradient(135deg,var(--acc),#6a4cf0);border-color:transparent;color:#fff}
  .meta{margin-top:16px;font-size:11px;color:#6b7180;word-break:break-all}
  .foot{margin-top:14px;text-align:center}.foot a{color:var(--acc2);text-decoration:none;font-size:12px}
</style>
</head>
<body>
  <div class="card">
    <div class="cover">[${esc(action)} 생성물]<span class="wm">🤖 AI 생성 · REMIX HUB</span></div>
    <div class="body">
      <h1>${esc(manifest.ip_name)} 컨셉 ${esc(action)}</h1>
      <div class="scope">${esc(manifest.license.scope)} · ${esc(manifest.license.terms)}</div>
      <span class="label">🤖 ${esc(manifest.ai_label.text)}</span>
      <div class="row" id="share"></div>
      <div class="meta">라이선스 해시: ${esc(manifest.manifest_hash)}</div>
      <div class="foot"><a href="${esc(opts.appUrl)}">REMIX HUB에서 더 보기 →</a></div>
    </div>
  </div>
<script>
  var url=${JSON.stringify(shareUrl)}, text=${JSON.stringify(title)};
  var e=encodeURIComponent, u=e(url), t=e(text);
  var links=[
    ['X(트위터)','https://twitter.com/intent/tweet?text='+t+'&url='+u,true],
    ['페이스북','https://www.facebook.com/sharer/sharer.php?u='+u,true],
    ['텔레그램','https://t.me/share/url?url='+u+'&text='+t,true],
    ['라인','https://social-plugins.line.me/lineit/share?url='+u,true]
  ];
  var c=document.getElementById('share');
  links.forEach(function(l){var a=document.createElement('a');a.className='btn';a.href=l[1];a.target='_blank';a.rel='noopener';a.textContent=l[0];c.appendChild(a);});
  var copy=document.createElement('button');copy.className='btn pri';copy.textContent='링크 복사';
  copy.onclick=function(){navigator.clipboard&&navigator.clipboard.writeText(url);copy.textContent='복사됨!';setTimeout(function(){copy.textContent='링크 복사';},1500);};
  c.appendChild(copy);
  if(navigator.share){var s=document.createElement('button');s.className='btn';s.textContent='공유…';s.onclick=function(){navigator.share({title:text,url:url});};c.appendChild(s);}
</script>
</body>
</html>`;
}
