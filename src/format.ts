import type { HistoryEntry } from './parser';

export type OutputFormat = 'jsonl' | 'tsv';

// TSV is one record per line, but a multi-line command carries real newlines
// once continuations are joined. Escape backslashes first so the newline
// escape can't be mistaken for one that was already in the command.
function escapeTsvCommand(command: string): string {
  return command.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

/**
 * Renders normalised entries as either JSON Lines (one object per command,
 * good for piping into other tools) or TSV (timestamp, tab, command).
 * Entries with no timestamp get `null` in jsonl and an empty first column
 * in tsv, rather than being timestamped with "now" -- guessing a time we
 * don't have would make the output less trustworthy, not more.
 */
export function formatEntries(entries: HistoryEntry[], format: OutputFormat): string {
  if (format === 'jsonl') {
    return entries.map((e) => JSON.stringify({ timestamp: e.timestamp, command: e.command })).join('\n');
  }
  if (format === 'tsv') {
    return entries.map((e) => `${e.timestamp ?? ''}\t${escapeTsvCommand(e.command)}`).join('\n');
  }
  throw new Error(`unknown output format: ${format}`);
}
