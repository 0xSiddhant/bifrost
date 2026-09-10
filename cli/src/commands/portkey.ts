import type { Command } from 'commander';
import { openInBrowser, shouldLaunch } from '../core/browser.js';
import { clientFromOptions } from '../core/client.js';
import {
  createPortkey,
  listPortkeys,
  removePortkey,
  resolvePortkey,
  updatePortkey,
} from '../core/portkey.js';
import {
  accent,
  CliError,
  dim,
  EXIT,
  formatWhen,
  heading,
  note,
  ok,
  plural,
  print,
  table,
  tintUrl,
} from '../core/output.js';

export function registerPortkey(program: Command): void {
  const portkey = program.command('portkey').description('manage LAN go-links');

  portkey
    .command('list')
    .description('list every go-link')
    .option('-q, --query <text>', 'fuzzy search slug, target and note')
    .action(async (options: { query?: string }, command: Command) => {
      const client = clientFromOptions(command.optsWithGlobals());
      const links = await listPortkeys(client, options.query);
      print(links, (rows) => {
        if (rows.length === 0) return dim('No go-links yet.');
        return [
          heading('Go-links'),
          table(rows, [
            { header: 'SLUG', value: (row) => row.slug, style: accent },
            { header: 'TARGET', value: (row) => row.url, style: tintUrl },
            { header: 'HITS', value: (row) => String(row.hits), align: 'right', style: dim },
            {
              header: 'LAST USED',
              value: (row) => (row.lastUsedAt === null ? 'never' : formatWhen(row.lastUsedAt)),
              style: dim,
            },
          ]),
          dim(plural(rows.length, 'link')),
        ].join('\n');
      });
    });

  portkey
    .command('create')
    .description('create a go-link')
    .argument('<slug>', 'the memorable word — lowercase kebab, and not a page name')
    .argument('<url>', 'where it should send you')
    .option('--note <text>', 'a reminder of what it is for')
    .action(async (slug: string, url: string, options: { note?: string }, command: Command) => {
      const client = clientFromOptions(command.optsWithGlobals());
      const link = await createPortkey(client, {
        slug,
        url,
        ...(options.note === undefined ? {} : { note: options.note }),
      });
      print({ ...link, go: `${client.baseUrl}/go/${link.slug}` }, (value) =>
        ok(`${accent(value.go)} → ${value.url}`),
      );
    });

  portkey
    .command('update')
    .description('change a go-link’s target or note (the slug itself is immutable)')
    .argument('<slug>')
    .option('--url <url>', 'new target')
    .option('--note <text>', 'new note; pass an empty string to clear it')
    .action(async (slug: string, options: { url?: string; note?: string }, command: Command) => {
      if (options.url === undefined && options.note === undefined) {
        throw new CliError('nothing to change — pass --url or --note');
      }
      const client = clientFromOptions(command.optsWithGlobals());
      const link = await updatePortkey(client, slug, {
        ...(options.url === undefined ? {} : { url: options.url }),
        ...(options.note === undefined ? {} : { note: options.note }),
      });
      print(link, (value) => ok(`${accent(value.slug)} → ${value.url}`));
    });

  portkey
    .command('rm')
    .description('delete a go-link')
    .argument('<slug>')
    .action(async (slug: string, _options: unknown, command: Command) => {
      const client = clientFromOptions(command.optsWithGlobals());
      await removePortkey(client, slug);
      print({ removed: slug }, (value) => ok(`removed ${accent(value.removed)}`));
    });

  // Top level, because following a go-link is the everyday verb and
  // `bifrost go router` is the whole command.
  program
    .command('go')
    .description('resolve a go-link to its target')
    .argument('<slug>')
    .option('--open', 'launch the target in your browser as well')
    .action(async (slug: string, options: { open?: boolean }, command: Command) => {
      const client = clientFromOptions(command.optsWithGlobals());
      const target = await resolvePortkey(client, slug);
      if (target === null) {
        throw new CliError(
          `no go-link called "${slug}" — create one with \`bifrost portkey create ${slug} <url>\``,
          EXIT.notFound,
        );
      }
      if (options.open === true && shouldLaunch(false)) {
        note(`opening ${target}…`);
        await openInBrowser(target);
      }
      print({ slug, url: target }, (value) => value.url);
    });
}
