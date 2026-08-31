import { access, copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const outputDirectory = join(projectRoot, 'dist');

const copyRequired = async (source, destination) => {
  await access(source, constants.R_OK);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
};

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await copyRequired(join(projectRoot, 'index.html'), join(outputDirectory, 'index.html'));
await copyRequired(join(projectRoot, 'sw.js'), join(outputDirectory, 'sw.js'));
await cp(join(projectRoot, 'public'), join(outputDirectory, 'public'), { recursive: true });

await copyRequired(
  join(projectRoot, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
  join(outputDirectory, 'public', 'vendor', 'supabase.js'),
);

console.log(`Nexo frontend generated at ${outputDirectory}`);
