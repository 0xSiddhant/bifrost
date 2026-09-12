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
- **No comments.** Nothing like `// ...` or `/* ... */` is valid JSON — if you need to annotate a JSON file, that's usually a sign you actually want something like YAML.
- **Duplicate keys are technically legal** per the spec, but which one "wins" is left to the parser. Don't rely on it — treat a JSON object as if keys must be unique.
- **Whitespace outside of strings is insignificant** — pretty-printing and minifying the same document produce the same data.
- **Strings escape with a backslash** — `\"`, `\\`, `\n`, `\t`, and `\uXXXX` for an arbitrary Unicode code point. A literal newline inside a string, unescaped, is invalid JSON, unlike in a lot of other formats.
- **Numbers can silently lose precision.** JSON itself places no limit on a number's size, but almost every parser reads numbers into a 64-bit float — safe up to `2^53 − 1` (`Number.MAX_SAFE_INTEGER` in JS). A 64-bit id or timestamp that exceeds that can come back rounded; large ids are often sent as strings specifically to dodge this.
- **JSON is not the same thing as a JavaScript object literal**, even though it started as a subset of one. `{ name: 'Ana' }` is valid JS, not valid JSON — unquoted keys and single-quoted strings are both JS-only conveniences JSON never adopted.
- **The MIME type is `application/json`** — that's also what `Accept`/`Content-Type` headers use to negotiate it over HTTP, and what Bifrost's own raw document endpoints send for a saved Runestone.

## Common mistakes

- Quoting a boolean or number by accident — `"true"` and `"42"` are strings, not the values `true` and `42`.
- Assuming key order is preserved. It usually is, in practice, in every mainstream implementation — but nothing in the spec actually guarantees it, so don't build logic that depends on it.
- Reaching for JSON5 or JSONC (which allow comments, trailing commas, and unquoted keys) and assuming a plain JSON parser will accept the same file — they're different, deliberately relaxed formats, not JSON with extra tolerance built in.

## Example

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
