import { site } from '../data/site.js';

export const prerender = true;

export function GET() {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /go/',
    '',
    'User-agent: OAI-SearchBot',
    'Allow: /',
    'Disallow: /go/',
    '',
    `Sitemap: ${site.origin}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
