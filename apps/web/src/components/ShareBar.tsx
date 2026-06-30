import { useState } from "react";

/**
 * External-platform share controls for an exported work. Points at the public,
 * server-rendered share page (/share/:exportId) which carries OG/Twitter meta
 * so links unfurl richly on X, Facebook, KakaoTalk, Slack, etc.
 */
export function ShareBar({ exportId, title }: { exportId: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/share/${exportId}`;
  const text = title ?? "REMIX HUB에서 만든 작품";
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);

  const links: [string, string][] = [
    ["X", `https://twitter.com/intent/tweet?text=${t}&url=${u}`],
    ["페이스북", `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ["텔레그램", `https://t.me/share/url?url=${u}&text=${t}`],
    ["라인", `https://social-plugins.line.me/lineit/share?url=${u}`],
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="sharebar">
      <div className="sharebar-title">🔗 외부 플랫폼으로 공유</div>
      <div className="sharebar-row">
        {links.map(([label, href]) => (
          <a key={label} className="btn gho" href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ))}
        <button className="btn pri" onClick={copy}>
          {copied ? "복사됨!" : "링크 복사"}
        </button>
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button className="btn gho" onClick={() => navigator.share({ title: text, url })}>
            공유…
          </button>
        )}
        <a className="btn gho" href={url} target="_blank" rel="noopener noreferrer">
          공유 페이지 ↗
        </a>
      </div>
      <div className="sharebar-url">{url}</div>
    </div>
  );
}
