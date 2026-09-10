(() => {
  const root = document.querySelector('[data-webinar-root]');
  const player = root?.querySelector('[data-player]');
  const progress = root?.querySelector('[data-progress]');
  const cta = root?.querySelector('[data-cta]');
  const error = root?.querySelector('[data-error]');
  const token = new URLSearchParams(location.search).get('t');
  if (!root || !player || !token || !crypto.randomUUID) return;

  function createNativePlayerAdapter(element, playbackSource) {
    element.src = playbackSource;
    return {
      on: (event, listener) => element.addEventListener(event, listener),
      currentTime: () => Number(element.currentTime),
      duration: () => Number(element.duration || root.dataset.duration),
      paused: () => element.paused,
      ended: () => element.ended,
    };
  }

  function createHlsPlayerAdapter(element, playbackSource) {
    if (globalThis.Hls?.isSupported()) {
      const hls = new globalThis.Hls({ enableWorker: true });
      hls.on(globalThis.Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) error.hidden = false;
      });
      hls.loadSource(playbackSource);
      hls.attachMedia(element);
    } else if (element.canPlayType('application/vnd.apple.mpegurl')) {
      element.src = playbackSource;
    } else {
      throw new Error('hls_unsupported');
    }
    return {
      on: (event, listener) => element.addEventListener(event, listener),
      currentTime: () => Number(element.currentTime),
      duration: () => Number(element.duration || root.dataset.duration),
      paused: () => element.paused,
      ended: () => element.ended,
    };
  }

  let adapter;
  try {
    adapter = root.dataset.videoProvider === 'mux-hls'
      ? createHlsPlayerAdapter(player, root.dataset.playbackSource)
      : createNativePlayerAdapter(player, root.dataset.playbackSource);
  } catch {
    error.hidden = false;
    return;
  }

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
    const positionSeconds = adapter.currentTime();
    const durationSeconds = adapter.duration();
    if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds)) return;
    queue = queue.then(() => post('/v1/webinar/telemetry', {
      clientSessionId, action, positionSeconds, durationSeconds,
    })).then((payload) => {
      progress.textContent = `Подтверждённый просмотр: ${Math.floor(payload.progressPercent)}%`;
      error.hidden = true;
    }).catch(() => { error.hidden = false; });
  }

  adapter.on('play', () => telemetry('play'));
  adapter.on('timeupdate', () => {
    if (adapter.currentTime() - lastHeartbeatPosition < 4) return;
    lastHeartbeatPosition = adapter.currentTime();
    telemetry('heartbeat');
  });
  adapter.on('pause', () => { if (!adapter.ended()) telemetry('pause'); });
  adapter.on('seeked', () => {
    lastHeartbeatPosition = adapter.currentTime();
    telemetry('seek');
    if (!adapter.paused()) telemetry('play');
  });
  adapter.on('ended', () => telemetry('ended'));

  cta?.addEventListener('click', () => {
    cta.setAttribute('aria-busy', 'true');
    queue = queue.then(() => post('/v1/webinar/cta', {}))
      .then(() => post('/v1/applications/token', {}))
      .then((payload) => { location.href = payload.url; })
      .catch(() => { cta.removeAttribute('aria-busy'); error.hidden = false; });
  });
})();
