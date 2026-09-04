# XML — a quick recap

XML (Extensible Markup Language) describes data as nested elements, each optionally carrying attributes. Unlike JSON, it was designed to be extended with document-specific rules — Apple's own plist format (which Atlas understands) is one real-world example of XML with its own strict vocabulary layered on top.

## Elements vs. attributes

```xml
<person name="Ana" role="admin">
  <email>ana@example.com</email>
</person>
```

`name` and `role` are **attributes** — one value each, attached directly to the tag. `<email>` is a **child element** — it can hold its own nested content, attributes, and children of its own. Attributes are for short, single-value facts about an element; elements are for structure.

## Facts worth knowing

- **Exactly one root element.** A document with two top-level elements side by side isn't well-formed — everything has to nest inside one outer tag.
- **Case-sensitive.** `<Item>` and `<item>` are different tags — closing one with the other is an error, not a typo XML forgives.
- **Self-closing tags** for elements with no content: `<br />`, not `<br></br>`.
- **Five characters need entity escapes** if they appear in text content: `&amp;` (`&`), `&lt;` (`<`), `&gt;` (`>`), `&quot;` (`"`), `&apos;` (`'`).
- **CDATA sections** (`<![CDATA[ raw text here ]]>`) let you embed text containing `<` or `&` without escaping every instance — useful for embedding a snippet of another language wholesale.
- **"Well-formed" and "valid" are different claims.** Well-formed means the syntax parses at all (matching tags, one root, proper escaping); valid means it also matches a schema or DTD. XML can be one without the other.
- **Comments** use the same syntax as HTML: `<!-- like this -->`.

## Declarations and namespaces

- **The XML declaration is optional but conventional**: `<?xml version="1.0" encoding="UTF-8"?>` at the very top, before the root element — it states the XML version and the text encoding the rest of the document is in, and nothing else.
- **`standalone="yes"|"no"`** in that same declaration says whether the document depends on an external DTD to be fully understood — most hand-written XML never sets it and defaults to "no."
- **Namespaces avoid tag-name collisions** between vocabularies mixed in one document: `xmlns:svg="http://www.w3.org/2000/svg"` declares a prefix, and `<svg:rect>` uses it. A default `xmlns="..."` (no prefix) applies to the element it's declared on and everything nested inside it.
- **Processing instructions** (`<?target data?>`) are a general escape hatch for embedding instructions meant for a specific tool — `<?xml-stylesheet ...?>` is the most common one still seen in the wild.
- **Whitespace inside an element can be significant or not**, and XML itself doesn't decide which — `xml:space="preserve"` is how a document tells a processor to keep whitespace exactly as written rather than collapsing it.

## Common mistakes

- An unescaped bare `&` or `<` inside text content — almost always the first thing that breaks a "well-formed" check, since both characters start a markup construct.
- Mismatched or unclosed tags, including forgetting that XML (unlike HTML) never tolerates an unclosed `<br>` or `<img>` — every element needs an explicit close or a self-closing `/>`.
- Assuming an XML file that opens cleanly in a browser is "valid" — a browser only checks well-formedness; validity against a schema or DTD is a separate, stricter question this format leaves optional.

## Example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
    <key>CFBundleName</key>
    <string>Bifrost</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
  </dict>
</plist>
```
