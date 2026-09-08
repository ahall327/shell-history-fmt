#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseHistory, dedupeEntries, StrictParseError } from './parser';
import { formatEntries, OutputFormat } from './format';

const USAGE = `usage: histfmt [file] [--lenient] [--dedupe] [--format jsonl|tsv]

Normalises a shell history file into one record per command.

  file           path to a history file (defaults to stdin)
  --lenient      recover from malformed or mixed-format input instead of
                 rejecting it; drops what can't be salvaged and reports a
                 summary on stderr
  --dedupe       keep only the last occurrence of each distinct command
  --format FMT   output format: jsonl (default) or tsv
  -h, --help     show this message
`;

interface Cli {
  path: string | null;
  lenient: boolean;
  dedupe: boolean;
  format: OutputFormat;
}

function parseArgs(argv: string[]): Cli {
  let path: string | null = null;
  let lenient = false;
  let dedupe = false;
  let format: OutputFormat = 'jsonl';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg === '--lenient') {
      lenient = true;
    } else if (arg === '--dedupe') {
      dedupe = true;
    } else if (arg === '--format') {
      const value = argv[++i];
      if (value !== 'jsonl' && value !== 'tsv') {
        throw new Error(`--format expects "jsonl" or "tsv", got ${JSON.stringify(value)}`);
      }
      format = value;
    } else if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length);
      if (value !== 'jsonl' && value !== 'tsv') {
        throw new Error(`--format expects "jsonl" or "tsv", got ${JSON.stringify(value)}`);
      }
      format = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`unrecognised option: ${arg}`);
    } else if (path === null) {
      path = arg;
    } else {
      throw new Error(`unexpected extra argument: ${arg}`);
    }
  }

  return { path, lenient, dedupe, format };
}

function readInput(path: string | null): string {
  if (path) return readFileSync(path, 'utf8');
  return readFileSync(0, 'utf8');
}

function main(): void {
  let cli: Cli;
  try {
    cli = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${USAGE}`);
    process.exit(2);
  }

  const input = readInput(cli.path);

  try {
    const { entries, issues, warnings } = parseHistory(input, { lenient: cli.lenient });
    if (warnings.length > 0) {
      process.stderr.write(`histfmt: ${warnings.length} timestamp warning(s):\n`);
      for (const warning of warnings) {
        process.stderr.write(`  line ${warning.line}: ${warning.message}\n`);
      }
    }
    if (issues.length > 0) {
      process.stderr.write(`histfmt: recovered from ${issues.length} problem(s):\n`);
      for (const issue of issues) {
        process.stderr.write(`  line ${issue.line}: ${issue.message}\n`);
      }
    }
    const output = cli.dedupe ? dedupeEntries(entries) : entries;
    process.stdout.write(formatEntries(output, cli.format) + '\n');
  } catch (err) {
    if (err instanceof StrictParseError) {
      process.stderr.write('histfmt: rejecting input (use --lenient to recover anyway):\n');
      for (const issue of err.issues) {
        process.stderr.write(`  line ${issue.line}: ${issue.message}\n`);
      }
      if (err.warnings.length > 0) {
        process.stderr.write(`histfmt: ${err.warnings.length} timestamp warning(s):\n`);
        for (const warning of err.warnings) {
          process.stderr.write(`  line ${warning.line}: ${warning.message}\n`);
        }
      }
      process.exit(1);
    }
    throw err;
  }
}

main();
