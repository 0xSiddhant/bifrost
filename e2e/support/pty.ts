/**
 * Run a command under a real pseudo-terminal through `script(1)`, so the CLI's
 * `isTTY` checks see a terminal exactly as they would in a person's shell.
 * `script` takes different arguments on the two platforms this project runs on:
 *
 *   Linux (util-linux):  script -qec "<command line>" /dev/null
 *   macOS (BSD):         script -q /dev/null <argv…>
 *
 * Linux takes one shell command string, so the argv is shell-quoted here.
 */

export function shellQuote(arg: string): string {
  if (/^[\w@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function ptyCommand(
  argv: string[],
  platform: NodeJS.Platform = process.platform,
): { file: string; args: string[] } {
  if (platform === 'darwin') return { file: 'script', args: ['-q', '/dev/null', ...argv] };
  return { file: 'script', args: ['-qec', argv.map(shellQuote).join(' '), '/dev/null'] };
}
