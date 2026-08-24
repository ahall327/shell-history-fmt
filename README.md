# shell-history-fmt

A small CLI that normalises shell history files into a single clean
format: one record per command, either JSON Lines or TSV.

## the problem

Shell history files are not one format. Depending on your shell and
settings you might have:

- zsh with `EXTENDED_HISTORY`, where every line looks like
  `: 1690000000:0;git status`
- bash with `HISTTIMEFORMAT` set, where a bare `#1690000000` line
  precedes each command
- plain bash/zsh history with no timestamps at all, just the commands
- some concatenation of the above, because you copied `.bash_history`
  from an old machine onto a new one that runs zsh, or merged history
  files from a few different shells by hand

Most tools that read history files assume one of these formats and
either crash or silently misparse the others. `histfmt` picks one
canonical output shape and either produces it cleanly or tells you
exactly what's wrong with the input.

## strictness

By default `histfmt` is strict: if it finds a line it can't parse
confidently, a timestamp marker with no command after it, a mix of
zsh and bash formats in the same file, or stray control characters in
a command, it refuses to produce output and prints every problem it
found (not just the first one) so you can fix the source file.

Pass `--lenient` to get a best-effort result instead: unparseable
pieces are dropped or cleaned up, and a summary of what was recovered
goes to stderr. Output goes to stdout either way, so the two never
mix.

## usage

```sh
npm install
npm run build

# strict by default -- rejects mixed or malformed input
histfmt ~/.zsh_history

# best-effort recovery
histfmt ~/.zsh_history --lenient

# read from stdin, write tab-separated instead of JSON lines
cat ~/.bash_history | histfmt --format tsv
```

Given this input (zsh extended history):

```
: 1690000000:0;git status
: 1690000042:0;npm test
```

`histfmt` produces:

```
{"timestamp":1690000000,"command":"git status"}
{"timestamp":1690000042,"command":"npm test"}
```

Given a file that mixes zsh and bash formats:

```
: 1690000000:0;git status
#1690000100
npm test
```

strict mode exits non-zero and prints:

```
histfmt: rejecting input (use --lenient to recover anyway):
  line 0: input mixes zsh extended-history (": <ts>:<elapsed>;cmd") and bash timestamp-comment ("#<ts>") formats
```

Re-running with `--lenient` merges both formats into one output
stream instead of refusing to touch it.

## output formats

- `jsonl` (default): one `{"timestamp": number | null, "command": string}` object per line
- `tsv`: `timestamp\tcommand`, with an empty first column when there's no timestamp

## status

Early skeleton. Multi-line commands (continuations), deduplication,
and timestamp-order checks aren't implemented yet -- see the issues
for what's next.

## license

MIT, see LICENSE.
