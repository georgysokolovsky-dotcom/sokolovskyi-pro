export class WebinarStarsApiError extends Error {
  constructor(code, category, status = null) {
    super(code);
    this.name = 'WebinarStarsApiError';
    this.code = code;
    this.category = category;
    this.status = status;
  }
}

function categoryForStatus(status) {
  if ([408, 425, 429].includes(status) || status >= 500) return 'retryable';
  if ([401, 403].includes(status)) return 'configuration';
  if (status >= 400) return 'permanent';
  return 'unknown';
}

function apiFailure(payload) {
  const errorValue = payload?.error;
  const failed = payload && typeof payload === 'object' && (errorValue === true
    || (typeof errorValue === 'number' && errorValue !== 0)
    || (typeof errorValue === 'string' && errorValue !== '' && errorValue !== '0')
    || payload.success === false || payload.ok === false);
  if (!failed) return null;
  const code = typeof payload.error_text === 'string' && payload.error_text ? payload.error_text.slice(0, 120) : 'webinarstars_api_error';
  const lower = code.toLowerCase();
  const category = /token|auth|access|permission/.test(lower) ? 'configuration' : /timeout|temporar|later|limit/.test(lower) ? 'retryable' : 'unknown';
  return new WebinarStarsApiError(code, category);
}

export function createWebinarStarsClient({ baseUrl, apiToken, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  if (!baseUrl || !apiToken || typeof fetchImpl !== 'function') throw new Error('WebinarStars API client configuration is required');
  async function request(path, parameters = {}) {
    const url = new URL(path, `${baseUrl.replace(/\/+$/, '')}/`);
    url.searchParams.set('token', apiToken);
    for (const [key, value] of Object.entries(parameters)) if (value != null) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    } catch (error) {
      throw new WebinarStarsApiError(error?.name === 'TimeoutError' ? 'webinarstars_timeout' : 'webinarstars_network_error', 'retryable');
    }
    if (!response.ok) throw new WebinarStarsApiError(`webinarstars_http_${response.status}`, categoryForStatus(response.status), response.status);
    let payload;
    try { payload = await response.json(); } catch { throw new WebinarStarsApiError('webinarstars_invalid_json', 'unknown', response.status); }
    const failure = apiFailure(payload);
    if (failure) throw failure;
    return payload;
  }
  return Object.freeze({
    getReports: () => request('api/get_reports/'),
    getReport: (reportId) => request('api/get_report/', { report: reportId, unique: 1 }),
    getCurrentReport: (webinarId, type = 'auto') => request('api/get_current_report/', { webinar: webinarId, type }),
  });
}
