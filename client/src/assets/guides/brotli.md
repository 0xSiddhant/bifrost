# Brotli — a quick recap

Brotli is a general-purpose compression algorithm Google published in 2015 ([RFC 7932](https://www.rfc-editor.org/rfc/rfc7932)), originally built for compressing web fonts and now widely used as an HTTP content encoding alongside gzip.

## Facts worth knowing

- **It usually beats gzip on text.** At a comparable speed tier, Brotli tends to produce smaller output than gzip for HTML, CSS, JSON, and other web-shaped text — mostly thanks to a large built-in dictionary of common web strings gzip doesn't have.
- **Quality and window size are the two real knobs.** Quality runs 0–11: higher means smaller output but slower compression. Window size (`lgwin`) controls how far back the compressor can look for repeated patterns — a bigger window helps more on larger inputs. Neither knob affects *decompression* speed, only how the data was packed in the first place.
- **Browsers decompress it natively, but can't produce it.** Any modern browser understands `Content-Encoding: br` with zero configuration — but there's no Brotli *encoder* built into the browser (the Web `CompressionStream` API only offers gzip/deflate), which is exactly why compressing has to happen somewhere else — in Bifrost's case, on the server.
- **It's a stream codec, not an archive format.** Brotli compresses one continuous stream of bytes; it doesn't bundle multiple files or preserve a folder structure the way a `.zip` does. Compressing a folder still means archiving it first.
- **Decompressing untrusted input needs a size cap.** A tiny compressed file can expand to an enormous amount of data (a "decompression bomb") — any tool that decompresses Brotli on someone else's input, this one included, has to bound the output size rather than trust the compressed size as a hint.

## How it works, briefly

Brotli combines three techniques: **LZ77-style back-references** (replacing a repeated chunk of text with a pointer to where it already appeared), a **large static dictionary** of roughly 13,000 common words and phrases pulled from real web content in dozens of languages (the single biggest reason it beats gzip on typical text, which has no dictionary at all), and **context modeling** on top of Huffman coding, which lets nearby bytes influence how the next one is encoded rather than treating every byte independently. None of that changes how it's *used* — it's still "give it bytes, get back fewer bytes" — but it explains why the ratio gap over gzip is biggest on ordinary text and much smaller on data that's already dense or random, like a JPEG or an already-compressed archive.

## Where you'll see it

- **HTTP responses**, negotiated via `Accept-Encoding: br` on the request and answered with `Content-Encoding: br` — the same negotiation gzip uses, just a different token.
- **The `.br` file extension**, conventionally appended to an already-named file the way `.gz` is for gzip.
- **Static asset pipelines and CDNs**, which often pre-compress a file once at build/deploy time rather than paying the (slower, higher-quality) compression cost on every request.

## Example

```
# Request
Accept-Encoding: gzip, deflate, br

# Response
Content-Encoding: br
Content-Type: text/html; charset=utf-8
Vary: Accept-Encoding
```
