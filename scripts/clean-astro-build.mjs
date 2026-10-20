import { lstatSync, rmSync } from 'node:fs';

const directoryName = process.env.LEGAL_PREVIEW === '1' ? 'dist-legal-preview' : 'dist';
const directory = new URL(`../${directoryName}`, import.meta.url);

let stats;
try {
  stats = lstatSync(directory);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

// lstat also rejects symlinks, so cleanup cannot follow one into source files.
if (stats && !stats.isDirectory()) {
  throw new Error(`Refusing to clean non-directory Astro output: ${directoryName}`);
}

rmSync(directory, { recursive: true, force: true });
console.log(`Cleaned Astro output: ${directoryName}/`);
