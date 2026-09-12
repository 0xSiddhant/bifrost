# Markdown — a quick recap

Markdown is a lightweight syntax for formatting plain text that still reads naturally unformatted. Edda (and this very guide) renders the GitHub-Flavored dialect — the version most people mean today when they say "Markdown."

## The core syntax

- **Headings**: `#` through `######` for six levels.
- **Emphasis**: `*italic*` or `_italic_`, `**bold**`.
- **Lists**: `-`, `*`, or `+` for bullets; `1.` for ordered — the actual numbers don't have to be sequential, Markdown renumbers them.
- **Links**: `[text](url)`. **Images**: same syntax with a `!` in front — `![alt text](url)`.
- **Inline code**: single backticks, `` `like this` ``. **Code blocks**: triple backticks, with an optional language tag right after the opening fence for syntax highlighting.
- **Blockquotes**: a `>` at the start of a line.
- **Tables** (a GitHub extension, not original Markdown): pipes for columns, a `---` separator row under the header.

## GFM extras beyond the core syntax

- **Task lists**: `- [ ]` for an open item, `- [x]` for a checked one — renders as an actual checkbox, not just literal brackets.
- **Strikethrough**: `~~like this~~`.
- **Autolinks**: a bare URL or `<user@example.com>` often renders as a clickable link with no `[text](url)` wrapper needed.
- **Reference-style links** separate the link from its target: `[Bifrost][repo]` in the text, and `[repo]: https://example.com` anywhere else in the document — handy for reusing the same URL in several places or keeping long links out of the running text.
- **Fenced code blocks take a language right after the opening fence** (` ```json `, ` ```yaml `, ` ```javascript `) — that's what tells the renderer which syntax-highlighting rules to apply; leave it off and the block still renders, just without coloring.

## Facts worth knowing

- **Raw HTML is often allowed inline** — most Markdown renderers pass it straight through. Bifrost sanitizes everything through DOMPurify before display, so a `<script>` tag (or anything else dangerous) is stripped rather than executed, no matter who wrote it.
- **`---` on its own line is a horizontal rule** — but the same three characters mean different things by context: at the very top of a file, many tools read it as the start of YAML front matter instead; inside a Saga presentation, it's the marker that ends one slide and starts the next.
- **There's no single official spec for "plain" Markdown** — [CommonMark](https://commonmark.org/) is the closest thing to a formal standard, and GitHub-Flavored Markdown (GFM) is CommonMark plus tables, strikethrough, task lists, and automatic linking.
- **Line breaks inside a paragraph need two trailing spaces (or a `<br>`)** — a single newline in the source is treated as a plain space when rendered.

## Common mistakes

- Writing `#Heading` with no space after the `#` — most renderers require the space to treat it as a heading at all, and quietly leave it as plain text otherwise.
- Forgetting the blank line before and after a block element (a list, a code fence, a blockquote) — Markdown generally needs that surrounding blank line to recognize where the block starts and ends.
- Nesting a list under another item with inconsistent indentation — a nested list generally needs to line up with the text of the parent bullet, not just be indented "some," or it renders as a new top-level list instead of a nested one.

## Example

```markdown
## Release notes

- **Added**: dark mode
- **Fixed**: a login bug

> Ship early, ship often.
```
