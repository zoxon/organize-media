#!/usr/bin/env node

import process from 'process';
import { parseArgs } from 'node:util';
import { runOrganizeMedia } from './index';

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    'recover-date': { type: 'boolean', short: 'r' },
  },
});

// Show help if no arguments or --help is passed
if (positionals.length === 0 || values.help) {
  console.log(`
Usage:
  npx organize-media <sourceDir> <targetDir> [--recover-date]

Options:
  -h, --help          Show this help message
  -r, --recover-date  Try to recover date from available metadata

Example:
  npx organize-media ~/Pictures ~/PicturesOrganized --recover-date
`);
  process.exit(0);
}

if (positionals.length < 2) {
  console.error('❌ Missing arguments. Use --help for usage.');
  process.exit(1);
}

const [sourceDir, targetDir] = positionals;
const recoverDate = Boolean(values['recover-date']);

runOrganizeMedia({ sourceDir, targetDir, recoverDate }).catch((err) => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
