# JSON — a quick recap

JSON (JavaScript Object Notation) started as a subset of JavaScript's own object syntax and became a language-independent format in its own right — the current spec is [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259). It has exactly **six** data types and no others.

## The six types

- **string** — always double-quoted: `"like this"`. Single quotes are not valid JSON.
- **number** — no distinction between integer and float. `1` and `1.0` are both just "number."
- **boolean** — `true` or `false`, lowercase, unquoted.
- **null** — `null`, lowercase, unquoted. Not the same as an empty string or a missing key.
- **object** — an unordered set of `"key": value` pairs in `{ }`.
- **array** — an ordered list of values in `[ ]`.

That's the whole type system. No `undefined`, no functions, no `Date`, no `NaN`/`Infinity` — anything that doesn't fit one of the six above isn't valid JSON.

## Facts worth knowing

- **Keys must be double-quoted strings, always** — `{name: "Ana"}` is not valid JSON; it has to be `{"name": "Ana"}`.
- **No trailing commas.** A comma after the last item in an object or array is a syntax error, unlike in JavaScript itself.
- **No comments.** Nothing like `// ...` or `/* ... */` is valid JSON. If a file needs notes, it is JSONC (below) or another format, and it should say so.
- **Duplicate keys are technically legal** per the spec, but which one "wins" is left to the parser. Don't rely on it — treat a JSON object as if keys must be unique.
- **Whitespace outside of strings is insignificant** — pretty-printing and minifying the same document produce the same data.
- **Strings escape with a backslash** — `\"`, `\\`, `\n`, `\t`, and `\uXXXX` for an arbitrary Unicode code point. A literal newline inside a string, unescaped, is invalid JSON, unlike in a lot of other formats.
- **Numbers can silently lose precision.** JSON itself places no limit on a number's size, but almost every parser reads numbers into a 64-bit float — safe up to `2^53 − 1` (`Number.MAX_SAFE_INTEGER` in JS). A 64-bit id or timestamp that exceeds that can come back rounded; large ids are often sent as strings specifically to dodge this.
- **JSON is not the same thing as a JavaScript object literal**, even though it started as a subset of one. `{ name: 'Ana' }` is valid JS, not valid JSON — unquoted keys and single-quoted strings are both JS-only conveniences JSON never adopted.
- **The MIME type is `application/json`**: what `Accept`/`Content-Type` headers use to negotiate it over HTTP, and what Bifrost's raw document endpoint sends for a saved strict-JSON Runestone.

## Common mistakes

- Quoting a boolean or number by accident — `"true"` and `"42"` are strings, not the values `true` and `42`.
- Assuming key order is preserved. It usually is, in practice, in every mainstream implementation — but nothing in the spec actually guarantees it, so don't build logic that depends on it.
- Assuming a plain JSON parser will read a JSONC or JSON5 file. They are different, deliberately relaxed formats, not JSON with extra tolerance built in.

## JSONC — JSON with comments

JSONC is the format of VS Code's `settings.json` and `tsconfig.json`: strict JSON plus two things, and nothing else.

- **Comments**: `// to the end of the line` and `/* a block, which may span lines */`, anywhere whitespace may go.
- **Trailing commas** after the last member of an object or the last item of an array: `[1, 2, 3,]`.

Everything else is still JSON's rule. **JSON5 is not JSONC**: unquoted keys, single-quoted strings, `NaN`, `Infinity`, hex numbers (`0x1F`), a leading `+` or `.5`, and strings continued across lines are all still errors. Text that only *looks* like a comment inside a string, such as `"http://bifrost.local/*path*/"`, is just a string.

### JSON or JSONC in Runestone

- **Every document has a format**, set by the **JSON / JSONC** switch at the start of the toolbar. New documents are JSON; a `.jsonc` file you import or drop opens as JSONC, even when its contents happen to be strict JSON.
- **The switch changes how the text is read, never the text.** Switch a commented document to JSON and the comments stay, marked as errors, and it cannot be saved until you switch back or remove them. The status line says when the text would be valid as JSONC.
- **Saving keeps the format.** It comes back with the document, in the Pensieve (a **JSONC** badge, and a format filter under the JSON chip) and on its raw URL, served as `application/jsonc` instead of `application/json`.
- **Format and Minify keep every comment.** Minify keeps a line break after a `//` comment, so it cannot swallow the next value.
- **Sort keys keeps each comment with its key**: a comment on the lines above a key, or after its value on the same line, moves with it; one on the `{` line stays at the top, one after the last key stays at the bottom. If that cannot be done safely, nothing is changed.
- **Unescape is off in JSONC**: it rebuilds the document and would drop the comments.
- **Copy as strict JSON** copies the document without its comments and trailing commas, every value exactly as written, and leaves the editor alone. Use it for a tool that only reads JSON.
- **Tree view, paths and Copy as JS** read the values and ignore the comments.
- **Variant** compares JSONC by value: a change that only touches comments is no difference at all.

## Examples

```json
{
  "name": "Bifrost",
  "version": 3,
  "stable": true,
  "codename": null,
  "modules": ["runestone", "edda", "groot", "atlas"],
  "limits": {
    "maxUploadMb": 2048,
    "sessionTimeoutSeconds": 3600
  }
}
```

A settings file in JSONC:

```jsonc
{
  // Shown in the header and the browser tab.
  "name": "Bifrost",
  "version": 3,
  /* Not released yet. */
  "stable": false,
  "modules": [
    "runestone",
    "edda",
    "groot",
    "atlas", // trailing commas are fine in JSONC
  ],
}
```
