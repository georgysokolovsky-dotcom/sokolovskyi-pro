function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export function renderWebinarPage({ webinar }) {
  const videoId = escapeHtml(webinar.videoId);
  const mediaUrl = escapeHtml(webinar.videoUrl);
  const videoProvider = escapeHtml(webinar.videoProvider);
  const duration = Number(webinar.durationSeconds);
  const hlsClient = webinar.videoProvider === 'mux-hls'
    ? '  <script src="/v1/webinar/hls.js" defer></script>\n'
    : '';
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <link rel="icon" href="data:,">
  <title>Видеоразбор — PRO Мужчин</title>
  <style>
    :root{color-scheme:dark;--bg:#101311;--card:#1a201c;--text:#f5f3eb;--muted:#b9beb8;--accent:#d9b36c}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% 0,#293229 0,var(--bg) 48%);color:var(--text);font:17px/1.55 system-ui,sans-serif}
    main{width:min(920px,calc(100% - 32px));margin:0 auto;padding:56px 0 72px}.eyebrow{color:var(--accent);font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
    h1{max-width:760px;margin:10px 0 14px;font:clamp(34px,7vw,64px)/1.04 Georgia,serif}p{color:var(--muted)}.card{margin-top:32px;padding:clamp(18px,4vw,34px);border:1px solid #39423b;border-radius:22px;background:rgba(26,32,28,.94);box-shadow:0 24px 80px #0005}
    video{display:block;width:100%;aspect-ratio:16/9;border-radius:14px;background:linear-gradient(135deg,#263127,#111);object-fit:contain}.progress{margin:14px 0 0;font-size:14px}
    .cta{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:18px;margin-top:24px;padding-top:24px;border-top:1px solid #39423b}.cta p{max-width:560px;margin:0}
    button{border:0;border-radius:999px;background:var(--accent);color:#17140f;padding:14px 22px;font:inherit;font-weight:750;cursor:pointer}button[aria-busy=true]{opacity:.65;cursor:wait}.error{color:#f2b8b5}
  </style>
</head>
<body>
  <main data-webinar-root data-video-id="${videoId}" data-video-provider="${videoProvider}" data-playback-source="${mediaUrl}" data-duration="${duration}">
    <div class="eyebrow">Закрытый видеоразбор</div>
    <h1>Видеоразбор</h1>
    <p>Прогресс сохраняется на сервере. Можно поставить запись на паузу и вернуться по той же действующей ссылке.</p>
    <section class="card">
      <video controls playsinline preload="metadata" data-player></video>
      <p class="progress" data-progress>Просмотр ещё не начат.</p>
      <div class="cta">
        <p>Если хотите разобрать свою ситуацию, перейдите к короткой заявке. В ней остаются только имя и описание ситуации.</p>
        <button type="button" data-cta>Перейти к заявке</button>
      </div>
      <p class="error" data-error hidden>Не удалось сохранить действие. Обновите страницу и попробуйте ещё раз.</p>
    </section>
  </main>
${hlsClient}  <script src="/v1/webinar/player.js" defer></script>
</body>
</html>`;
}

export function renderWebinarDeniedPage() {
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="icon" href="data:,"><title>Ссылка недействительна</title></head><body><main><h1>Ссылка недействительна или истекла</h1><p>Запросите новую ссылку в Telegram.</p></main></body></html>';
}
