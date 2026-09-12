# YAML — a quick recap

YAML ("YAML Ain't Markup Language") trades JSON's brackets and quotes for indentation and bare words, which makes it easier to hand-write and easier to misread — most of YAML's reputation for hidden traps comes from how much it's willing to guess about a bare, unquoted value.

## Facts worth knowing

- **Indentation is significant, and it's always spaces.** A tab in the indentation is a parse error, not a style complaint — nesting is expressed purely by how many spaces a line starts with.
- **Bare words can silently become booleans.** Depending on which YAML version a parser follows, `yes`, `no`, `on`, and `off` — not just `true`/`false` — can all parse as booleans. `country: no` reads as the *string* "no" to a YAML 1.2 parser and as *boolean false* to a YAML 1.1 one. Groot's own advisory rail flags exactly this kind of trap live, in whatever you've actually typed — quote a value (`"no"`) whenever you mean it literally as text.
- **Numbers can surprise you too.** A bare `1.0` parses as a float, not an integer; some parsers read a leading-zero number like `010` as octal; a bare date-shaped value like `2024-01-01` gets auto-parsed as an actual date/timestamp by some tools rather than kept as text.
- **Anchors and aliases avoid repeating a block.** `&base` marks a node as reusable; `*base` inserts it again elsewhere in the same document — a lightweight copy-paste built into the format itself.
- **Flow style is valid inside block style.** Alongside the usual indented form, YAML has a compact, JSON-like inline syntax — `{a: 1, b: 2}` and `[1, 2, 3]` are both legal YAML, and can appear mixed into an otherwise normal indented document.
- **Comments are allowed** (`# like this`) — unlike JSON, where they're a syntax error.
- **`---` separates multiple documents in one file** — the same three-character marker Markdown uses for a horizontal rule and Saga uses for a slide break, doing a third, unrelated job here. An optional `...` marks the end of a document without starting a new one.

## Multi-line strings and null

- **Two ways to write a multi-line string, and they behave differently.** A literal block scalar (`|`) keeps every line break exactly as written; a folded block scalar (`>`) turns single line breaks into spaces, so a paragraph wrapped across several lines re-joins into one. Both can add a trailing-newline modifier — `|-`/`>-` strips the final newline, `|+`/`>+` keeps extra blank lines that would otherwise be trimmed.
- **Null has more spellings than JSON's single `null`.** A tilde (`~`), the bare word `null`, and simply leaving a key's value empty all mean the same thing.
- **A value's type can be forced explicitly** with a tag — `!!str 42` is the string `"42"`, not the number, overriding whatever YAML would have guessed on its own.
- **Merge keys (`<<`)** pull the contents of one mapping into another, a YAML-native way to do "inherit these defaults, then override a few fields" without anchors/aliases doing the whole job.

## Common mistakes

- Mixing tabs and spaces in the same file — YAML forbids tabs for indentation entirely, and a stray one is a parse error, not a formatting inconsistency a tool quietly fixes.
- Two list items at slightly different indentation levels, intended to be siblings — YAML reads the difference as one item nested inside the other rather than a typo to forgive.
- Writing a value that looks like a number or boolean when a literal string was intended (a version string `3.10`, a "no" answer, a leading-zero code) without quoting it — see the `country: no` example above; the same shape of surprise applies to numbers and dates too.

## Example

```yaml
name: bifrost
stable: true
country: "no"      # quoted on purpose — otherwise a YAML 1.1 reader parses it as `false`
release_year: 2024
maintainers:
  - name: Ada
    role: lead
```
