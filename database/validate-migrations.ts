#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';

const migrationsDir = path.join(__dirname, 'migrations');

function main() {
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const prefixMap = new Map<string, string[]>();

  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (!match) {
      console.error(`Invalid migration filename format: ${file}`);
      process.exit(1);
    }
    const prefix = match[1];
    if (!prefixMap.has(prefix)) {
      prefixMap.set(prefix, []);
    }
    prefixMap.get(prefix)!.push(file);
  }

  let hasDuplicates = false;
  for (const [prefix, filenames] of prefixMap) {
    if (filenames.length > 1) {
      hasDuplicates = true;
      console.error(`Duplicate prefix ${prefix}: ${filenames.join(', ')}`);
    }
  }

  if (hasDuplicates) {
    process.exit(1);
  }

  console.log('All migration filenames have unique prefixes!');
}

main();
