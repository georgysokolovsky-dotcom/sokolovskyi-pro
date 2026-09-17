import { createWebinarStarsClient } from '../src/webinarstars/client.mjs';
import { normalizeReport, normalizeReports } from '../src/webinarstars/normalize.mjs';

const apiToken = process.env.WEBINARSTARS_API_TOKEN;
const baseUrl = process.env.WEBINARSTARS_API_BASE_URL;
const timeZone = process.env.WEBINARSTARS_TIME_ZONE;
const reportId = process.argv[2];
if (!apiToken || !baseUrl || !timeZone || !/^\d+$/.test(reportId ?? '')) throw new Error('WEBINARSTARS_API_TOKEN, WEBINARSTARS_API_BASE_URL, WEBINARSTARS_TIME_ZONE and numeric report id are required');

const client = createWebinarStarsClient({ baseUrl, apiToken });
const [payload, reportsPayload] = await Promise.all([client.getReport(reportId), client.getReports()]);
const report = normalizeReport(payload, { timeZone });
const discovery = normalizeReports(reportsPayload, { timeZone }).find((item) => item.reportId === reportId) ?? null;
function schema(value, depth = 0) {
  if (depth > 3) return Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (Array.isArray(value)) return { type: 'array', length: value.length, item: value.length ? schema(value[0], depth + 1) : null };
  if (!value || typeof value !== 'object') return typeof value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, schema(value[key], depth + 1)]));
}
console.log(JSON.stringify({
  ok: report.reportId === reportId,
  reportId: report.reportId,
  discoveryFound: Boolean(discovery),
  discoveryWebinarMatches: discovery ? discovery.webinarId === report.webinarId : false,
  discoveryTimestampsPresent: Boolean(discovery?.scheduledStart && discovery?.scheduledEnd),
  webinarIdPresent: Boolean(report.webinarId),
  visitorCount: report.visitors.length,
  visitorFields: report.visitors.length ? ['visitorId', 'rawUtm', 'presenceStarted', 'presenceEnded', 'presenceSeconds', 'buttons', 'commentCount'] : [],
  buttonStatuses: [...new Set(report.visitors.flatMap((visitor) => visitor.buttons.map((button) => button.status)))].sort(),
  commentCountsOnly: true,
  ...(process.env.WEBINARSTARS_VERIFY_SCHEMA === 'true' ? { payloadSchema: schema(payload) } : {}),
}));
