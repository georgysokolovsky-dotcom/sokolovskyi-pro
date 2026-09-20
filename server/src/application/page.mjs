const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function renderApplicationPage({ submitted = false } = {}, { privacyPolicyUrl = null, consentVersion = null, consentText = null } = {}) {
  const attributes = consentVersion ? ` data-consent-version="${escapeHtml(consentVersion)}" data-consent-source="production_application_form"` : '';
  const policyLabel = 'Политикой конфиденциальности';
  const label = escapeHtml(consentText || `Я ознакомился с ${policyLabel}.`);
  const linkedLabel = privacyPolicyUrl && label.includes(policyLabel)
    ? label.replace(policyLabel, `<a href="${escapeHtml(privacyPolicyUrl)}" target="_blank" rel="noopener noreferrer">${policyLabel}</a>`)
    : label;
  const content = submitted
    ? '<h1>Заявка уже отправлена</h1><p>Повторно заполнять форму не нужно.</p>'
    : `<h1>Записаться на разбор</h1>
      <form id="application-form"${attributes}>
        <label for="name">Имя</label><input id="name" name="name" maxlength="200" required autocomplete="name">
        <label for="phone">Телефон</label><input id="phone" name="phone" type="tel" inputmode="tel" maxlength="40" required autocomplete="tel">
        <p class="privacy-note">Данные используются для рассмотрения заявки и связи с вами.</p>
        <label class="consent"><input type="checkbox" name="consent" required> <span>${linkedLabel}</span></label>
        <button type="submit">Записаться на разбор</button><p id="status" role="status" aria-live="polite"></p>
      </form><script src="/v1/applications/form.js" defer></script>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Записаться на разбор</title><style>
    :root{color-scheme:light;font:16px/1.55 system-ui,sans-serif;background:#f7f5f0;color:#20231f}
    body{margin:0;padding:clamp(20px,5vw,64px)}main{max-width:580px;margin:0 auto;background:white;padding:clamp(24px,5vw,48px);border-radius:16px;box-shadow:0 6px 32px #20231f12}
    h1{font-size:clamp(28px,5vw,38px);line-height:1.15;margin:0 0 20px}p{margin:0 0 24px}form{display:grid;gap:12px}label{font-weight:600}
    input:not([type=checkbox]){font:inherit;border:1px solid #767b73;border-radius:8px;padding:12px;width:100%;box-sizing:border-box}
    .privacy-note{margin:2px 0;color:#596159;font-size:14px}.consent{display:flex;align-items:start;gap:10px;font-weight:400;margin:10px 0}.consent input{margin-top:5px}button{font:inherit;background:#244d3b;color:#fff;border:0;border-radius:8px;padding:14px;cursor:pointer}button:disabled{opacity:.65;cursor:wait}
    #status{margin:0}#status:empty{display:none}</style></head><body><main>${content}</main></body></html>`;
}

export function renderApplicationDeniedPage() {
  return '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ссылка недоступна</title><p>Ссылка недоступна или срок её действия истёк.</p></html>';
}
