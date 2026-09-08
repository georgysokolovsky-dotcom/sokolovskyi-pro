import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://sokolovskyi.pro',
  output: 'static',
  // Legacy public/ remains the GitHub Pages source. Astro uses this parallel
  // asset mirror so its generated robots.txt and sitemap.xml are authoritative.
  publicDir: './public-astro',
  trailingSlash: 'ignore',
});
