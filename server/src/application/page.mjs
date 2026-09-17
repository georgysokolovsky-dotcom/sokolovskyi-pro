export function renderApplicationPage({ submitted = false } = {}) {
  const content = submitted
    ? '<h1>Заявка уже отправлена</h1><p>Повторно заполнять форму не нужно.</p>'
    : `<h1>Запись на разбор</h1>
      <p>Опиши ситуацию своими словами. Эти данные нужны для подготовки к встрече.</p>
      <form id="application-form">
        <label for="name">Имя</label><input id="name" name="name" maxlength="200" required autocomplete="name">
        <label for="situation">Что происходит сейчас</label><textarea id="situation" name="situation" maxlength="2000" required rows="6"></textarea>
        <label class="consent"><input type="checkbox" name="consent" required> Согласен передать эти данные для рассмотрения заявки</label>
        <button type="submit">Отправить заявку</button><p id="status" role="status" aria-live="polite"></p>
      </form><script src="/v1/applications/form.js" defer></script>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Запись на разбор</title><style>
    :root{color-scheme:light;font:16px/1.55 system-ui,sans-serif;background:#f7f5f0;color:#20231f}
    body{margin:0;padding:clamp(20px,5vw,64px)}main{max-width:580px;margin:0 auto;background:white;padding:clamp(24px,5vw,48px);border-radius:16px;box-shadow:0 6px 32px #20231f12}
    h1{font-size:clamp(28px,5vw,38px);line-height:1.15;margin:0 0 20px}p{margin:0 0 24px}form{display:grid;gap:12px}label{font-weight:600}
    input:not([type=checkbox]),textarea{font:inherit;border:1px solid #767b73;border-radius:8px;padding:12px;width:100%;box-sizing:border-box}textarea{resize:vertical}
    .consent{display:flex;align-items:start;gap:10px;font-weight:400;margin:10px 0}.consent input{margin-top:5px}button{font:inherit;background:#244d3b;color:#fff;border:0;border-radius:8px;padding:14px;cursor:pointer}button:disabled{opacity:.65;cursor:wait}
    #status{margin:0}#status:empty{display:none}</style></head><body><main>${content}</main></body></html>`;
}

export function renderApplicationDeniedPage() {
  return '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ссылка недоступна</title><p>Ссылка недоступна или срок её действия истёк.</p></html>';
}
