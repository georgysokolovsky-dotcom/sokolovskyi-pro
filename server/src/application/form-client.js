const form = document.getElementById('application-form');
if (form) {
  const status = document.getElementById('status');
  const token = new URL(location.href).searchParams.get('t');
  history.replaceState(null, '', '/application');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Отправляем заявку…';
    try {
      const body = {
        token,
        answers: { name: form.elements.name.value, situation: form.elements.situation.value },
        consent: { accepted: form.elements.consent.checked, policyVersion: 'men_application_staging_v1', source: 'staging_application_form' },
      };
      const response = await fetch('/v1/applications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error('submission_failed');
      form.replaceWith(Object.assign(document.createElement('p'), { textContent: 'Заявка отправлена. Спасибо.' }));
    } catch {
      status.textContent = 'Не удалось отправить заявку. Попробуй ещё раз.';
      button.disabled = false;
    }
  });
}
