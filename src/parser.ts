export interface HistoryEntry {
  /** Unix epoch seconds, or null when the source line carried no timestamp. */
  timestamp: number | null;
  command: string;
}

export interface ParseIssue {
  line: number;
  message: string;
  raw: string;
}

export class StrictParseError extends Error {
  issues: ParseIssue[];

  constructor(issues: ParseIssue[]) {
    super(`refusing to continue: ${issues.length} problem(s) found in strict mode`);
    this.name = 'StrictParseError';
    this.issues = issues;
  }
}

export interface ParseResult {
  entries: HistoryEntry[];
  issues: ParseIssue[];
}

export interface ParseOptions {
  lenient: boolean;
}

// zsh EXTENDED_HISTORY: ": <start-epoch>:<elapsed-seconds>;<command>"
const ZSH_EXTENDED_RE = /^:\s*(\d+):(\d+);(.*)$/;
// bash with HISTTIMEFORMAT set writes a bare "#<epoch>" line before each command
const BASH_MARKER_RE = /^#(\d+)$/;
// control characters other than tab, which we treat as ordinary whitespace
const CONTROL_CHAR_RE = new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]");

function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHAR_RE, "");
}

function countTrailingBackslashes(text: string): number {
  let count = 0;
  for (let i = text.length - 1; i >= 0 && text[i] === '\\'; i--) count++;
  return count;
}

interface ResolvedCommand {
  command: string;
  lastIndex: number;
  dangling: boolean;
}

// zsh and HISTTIMEFORMAT-bash both write a multi-line command to the history
// file by replacing each embedded newline with a backslash followed by a
// real newline. An odd number of trailing backslashes means "this line
// continues"; an even number (including zero) means the backslashes are
// literal and the command ends here.
function resolveCommand(lines: string[], startIndex: number, initial: string): ResolvedCommand {
  let text = initial;
  let i = startIndex;
  while (countTrailingBackslashes(text) % 2 === 1) {
    if (i + 1 >= lines.length) {
      return { command: text, lastIndex: i, dangling: true };
    }
    text = text.slice(0, -1) + '\n' + lines[i + 1];
    i++;
  }
  return { command: text, lastIndex: i, dangling: false };
}

/**
 * Parses a raw shell history file that may be in zsh extended-history
 * format, bash timestamp-comment format, plain newline-separated commands
 * with no timestamps, or some mixture of the three -- which is what
 * usually happens once history files get synced between machines or
 * concatenated by hand.
 *
 * In strict mode (the default) any problem is collected and reported, and
 * the whole input is rejected rather than silently guessed at. Pass
 * `lenient: true` to recover as much as possible instead.
 */
export function parseHistory(input: string, options: ParseOptions): ParseResult {
  const lines = input.split(/\r\n|\n/);
  const entries: HistoryEntry[] = [];
  const issues: ParseIssue[] = [];
  let sawZsh = false;
  let sawBashMarker = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    const lineNo = i + 1;

    const zshMatch = raw.match(ZSH_EXTENDED_RE);
    if (zshMatch) {
      sawZsh = true;
      const timestamp = Number(zshMatch[1]);
      const resolved = resolveCommand(lines, i, zshMatch[3]);
      let command = resolved.command;
      if (resolved.dangling) {
        issues.push({ line: lineNo, message: 'command continuation backslash at end of file has no following line', raw });
        if (options.lenient) command = command.slice(0, -1);
      }
      if (CONTROL_CHAR_RE.test(command)) {
        issues.push({ line: lineNo, message: 'command contains control characters', raw });
        if (options.lenient) command = stripControlChars(command);
      }
      entries.push({ timestamp, command });
      i = resolved.lastIndex;
      continue;
    }

    const markerMatch = raw.match(BASH_MARKER_RE);
    if (markerMatch) {
      const next = lines[i + 1];
      if (next === undefined || next.trim() === '') {
        issues.push({ line: lineNo, message: 'timestamp marker is not followed by a command', raw });
        continue;
      }
      sawBashMarker = true;
      const timestamp = Number(markerMatch[1]);
      const resolved = resolveCommand(lines, i + 1, next);
      let command = resolved.command;
      if (resolved.dangling) {
        issues.push({ line: lineNo + 1, message: 'command continuation backslash at end of file has no following line', raw: next });
        if (options.lenient) command = command.slice(0, -1);
      }
      if (CONTROL_CHAR_RE.test(command)) {
        issues.push({ line: lineNo + 1, message: 'command contains control characters', raw: next });
        if (options.lenient) command = stripControlChars(command);
      }
      entries.push({ timestamp, command });
      i = resolved.lastIndex;
      continue;
    }

    // A plain line: either an untimed command, or an actual shell comment
    // the user typed at the prompt (e.g. "# fixed in a later commit").
    const resolved = resolveCommand(lines, i, raw);
    let command = resolved.command;
    if (resolved.dangling) {
      issues.push({ line: lineNo, message: 'command continuation backslash at end of file has no following line', raw });
      if (options.lenient) command = command.slice(0, -1);
    }
    if (CONTROL_CHAR_RE.test(command)) {
      issues.push({ line: lineNo, message: 'command contains control characters', raw });
      if (options.lenient) command = stripControlChars(command);
    }
    entries.push({ timestamp: null, command });
    i = resolved.lastIndex;
  }

  if (sawZsh && sawBashMarker) {
    issues.push({
      line: 0,
      message:
        'input mixes zsh extended-history (": <ts>:<elapsed>;cmd") and bash timestamp-comment ("#<ts>") formats',
      raw: '',
    });
  }

  if (issues.length > 0 && !options.lenient) {
    throw new StrictParseError(issues);
  }

  return { entries, issues };
}

// Keeps only the last occurrence of each distinct command, in the order
// those occurrences originally appeared -- the same convention zsh's
// HIST_IGNORE_ALL_DUPS uses, since the most recent run of a command is
// almost always the one worth keeping a record of.
export function dedupeEntries(entries: HistoryEntry[]): HistoryEntry[] {
  const lastIndexForCommand = new Map<string, number>();
  entries.forEach((entry, index) => lastIndexForCommand.set(entry.command, index));
  return entries.filter((entry, index) => lastIndexForCommand.get(entry.command) === index);
}
