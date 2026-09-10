(() => {
  const root = document.querySelector('[data-webinar-root]');
  const player = root?.querySelector('[data-player]');
  const progress = root?.querySelector('[data-progress]');
  const cta = root?.querySelector('[data-cta]');
  const error = root?.querySelector('[data-error]');
  const token = new URLSearchParams(location.search).get('t');
  if (!root || !player || !token || !crypto.randomUUID) return;

  const clientSessionId = crypto.randomUUID();
  let queue = Promise.resolve();
  let lastHeartbeatPosition = 0;

  async function post(path, body, requestId = crypto.randomUUID()) {
    const request = () => fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, requestId, ...body }),
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
      keepalive: ['pause', 'ended'].includes(body.action),
    });
    let response;
    try { response = await request(); } catch { response = await request(); }
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'request_failed');
    return payload;
  }

  function telemetry(action) {
    const positionSeconds = Number(player.currentTime);
    const durationSeconds = Number(player.duration || root.dataset.duration);
    if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds)) return;
    queue = queue.then(() => post('/v1/webinar/telemetry', {
      clientSessionId, action, positionSeconds, durationSeconds,
    })).then((payload) => {
      progress.textContent = `Подтверждённый просмотр: ${Math.floor(payload.progressPercent)}%`;
      error.hidden = true;
    }).catch(() => { error.hidden = false; });
  }

  player.addEventListener('play', () => telemetry('play'));
  player.addEventListener('timeupdate', () => {
    if (player.currentTime - lastHeartbeatPosition < 4) return;
    lastHeartbeatPosition = player.currentTime;
    telemetry('heartbeat');
  });
  player.addEventListener('pause', () => { if (!player.ended) telemetry('pause'); });
  player.addEventListener('seeked', () => {
    lastHeartbeatPosition = player.currentTime;
    telemetry('seek');
    if (!player.paused) telemetry('play');
  });
  player.addEventListener('ended', () => telemetry('ended'));

  cta?.addEventListener('click', () => {
    cta.setAttribute('aria-busy', 'true');
    queue = queue.then(() => post('/v1/webinar/cta', {}))
      .then(() => post('/v1/applications/token', {}))
      .then((payload) => { location.href = payload.url; })
      .catch(() => { cta.removeAttribute('aria-busy'); error.hidden = false; });
  });
})();
