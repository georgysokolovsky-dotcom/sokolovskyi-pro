import { site } from '../../data/site.js';

export const prerender = true;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function GET() {
  const allowedKeys = JSON.stringify(site.webinarParamKeys);
  const target = escapeHtml(site.webinarTarget);
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Переход на вебинар — PRO Мужчин</title><meta name="description" content="Переход на страницу вебинара."><meta name="robots" content="noindex, follow"><meta property="og:title" content="Переход на вебинар — PRO Мужчин"><meta property="og:description" content="Переход на страницу вебинара."><meta name="twitter:card" content="summary"><style>:root{font-family:system-ui,sans-serif;color:#f7f5ef;background:#121c23}*{box-sizing:border-box}body{display:grid;min-height:100vh;place-content:center;margin:0;padding:36px;text-align:center}.mark{margin-bottom:40px;font:32px/1 Georgia,serif}h1{max-width:760px;margin:0 0 13px;font:400 clamp(42px,6vw,55px)/.98 Georgia,serif}p{color:rgba(247,245,239,.7)}a{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 27px;color:#fffaf5;background:#b85e46;text-decoration:none;font-size:14px}</style></head><body><main class="redirect-page"><div class="mark">PRO Мужчин</div><h1>Переходим на страницу вебинара…</h1><p>Если переход не продолжился автоматически, используй ссылку ниже.</p><a id="webinar-fallback" href="${target}">Открыть страницу вебинара</a></main><script>const keys=${allowedKeys};const link=document.querySelector('#webinar-fallback');if(link){const source=new URLSearchParams(window.location.search);const destination=new URL(link.href);keys.forEach((key)=>{const value=source.get(key);if(value&&value.length<=120)destination.searchParams.set(key,value)});link.href=destination.toString()}</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
