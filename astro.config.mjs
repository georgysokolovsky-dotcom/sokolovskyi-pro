import { defineConfig } from 'astro/config';
const draftPreview = process.env.DRAFT_PREVIEW === '1' && process.argv.includes('dev');
export default defineConfig({
  site: 'https://sokolovskyi.pro',
  output: 'static',
  publicDir: './public-astro',
  trailingSlash: 'ignore',
  integrations: [{ name: 'local-draft-routes', hooks: { 'astro:config:setup': ({ injectRoute }) => {
    if (draftPreview) {
      injectRoute({ pattern: '/__drafts/', entrypoint: './src/local-preview/index.astro' });
      injectRoute({ pattern: '/__drafts/[slug]/', entrypoint: './src/local-preview/article.astro' });
    }
  } } }],
});
