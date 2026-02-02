#!/usr/bin/env node

import process from 'process';
import path from 'path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);

// Show help if no arguments or --help is passed
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage:
  npx organize-media <sourceDir> <targetDir>

Options:
  -h, --help      Show this help message

Example:
  npx organize-media ~/Pictures ~/Pictures/Organized
`);
  process.exit(0);
}

// Resolve the compiled JS file in dist
const scriptPath = path.resolve(__dirname, 'dist', 'index.js');

const child = spawn(process.execPath, [scriptPath, ...args], {
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
