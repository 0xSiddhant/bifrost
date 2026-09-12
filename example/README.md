# Example deck

`local-first-lan.md` is a complete conference-length talk, written as a Saga
deck. It is here to be *presented*, not just read — it exercises every part of
the format at once: `---` slide breaks, a presenter note on all sixteen slides,
fenced code in four languages, a Mermaid diagram, tables and a blockquote.

Every slide fits the frame on a 1440px-wide screen or larger. Below that the
longest one (slide 11, the kill test) scrolls inside its own frame rather than
growing the page — which is the behaviour worth seeing, so it is worth opening
the deck on a laptop at least once.

## Present it

From a terminal, against a running Bifrost:

```bash
bifrost preview example/local-first-lan.md --type saga
```

Or in a browser: open **Midgard → Saga** and drop the file on the page. Nothing
is uploaded and nothing is stored — the deck is read straight out of the tab.

To keep it, paste it into **Edda**, save, and use **Present** on its Pensieve
row.

## The one piece of syntax worth copying

A presenter note is an HTML comment, so it is invisible everywhere except
Saga's notes panel (`N`, or the Notes button):

```markdown
## The slide everyone sees

<!-- notes: The part only you see. Slow down here. -->
```

The colon is what makes it a note rather than an ordinary comment, and it
belongs on its own line. Edda's toolbar has a **Note** button that writes both
for you.
