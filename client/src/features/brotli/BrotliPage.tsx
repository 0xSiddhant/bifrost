import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../core/api';
import { takeBrotliSeed } from '../../core/brotliSeed';
import { gzipBytes, hasCompressionStream } from '../../core/compressionSupport';
import { detectFormat } from '../../core/contentFormat/registry';
import type { ContentFormatEntry } from '../../core/contentFormat/types';
import { copyText } from '../../core/copy';
import { formatBytes } from '../../core/format';
import { log } from '../../core/log';
import { useCapabilities } from '../../core/useCapabilities';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { Toast } from '../../core/ui/Toast';
import { AlertIcon, ArchiveFileIcon } from '../../core/ui/icons';
import {
  compressContent,
  decompressContent,
  fetchBrotliConfig,
  sendToHermes,
  type BrotliConfig,
} from './api';
import {
  compressedName,
  decompressedName,
  gzippedName,
  looksLikeText,
  savedPercent,
  saveBlob,
  toBase64,
} from './bytes';
import { DEFAULT_QUALITY, QUALITIES, qualityLabel, qualityLevel, type BrotliQualityName } from './quality';
import './brotli.css';

/**
 * One threshold, not two. Rendering a decompressed blob into a scrollable view
 * and running three real parsers over it are both expensive, and splitting them
 * into a "display cap" and a larger "detection cap" would be two numbers with
 * no independent justification for either. Below it the content is shown and
 * detection runs; above it the page offers a download and nothing else —
 * nothing partially rendered, no parser started. Stated by reasoning rather
 * than pinned to a benchmark, the way Variant's and Atlas's own bounds are.
 */
const DISPLAY_MAX_BYTES = 8 * 1024 * 1024;

/**
 * A different guard, for a different cost. Neither "Copy as base64" nor "Send
 * to Hermes" runs a parser, so the threshold above is the wrong number to
 * reuse — but base64-encoding and then clipboard-writing (or POSTing) a very
 * large string is still slow enough on the main thread to be felt, and for
 * Hermes it would be spent only to earn a 413 against its own text cap.
 * Generous enough never to fire on the paste-into-a-config-value case these
 * actions exist for; small enough to refuse a blob outright rather than hang.
 */
const COPY_MAX_BYTES = 1024 * 1024;

type Mode = 'compress' | 'decompress';

interface CompressResult {
  bytes: Uint8Array;
  sourceBytes: number;
  sourceName: string | null;
  quality: BrotliQualityName;
  gzip: { size: number; blob: Blob } | null;
}

interface DecompressResult {
  bytes: Uint8Array;
  sourceBytes: number;
  sourceName: string | null;
  isText: boolean;
  /** Null when the blob is binary, or too large to render — see DISPLAY_MAX_BYTES. */
  text: string | null;
  format: ContentFormatEntry | null;
}

export function BrotliPage() {
  const navigate = useNavigate();
  const { capabilities } = useCapabilities();
  const hasModule = useCallback(
    (module: string) => !capabilities || capabilities.modules.includes(module),
    [capabilities],
  );

  const [config, setConfig] = useState<BrotliConfig | null>(null);
  const [mode, setMode] = useState<Mode>('compress');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [text, setText] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [seedFrom, setSeedFrom] = useState<string | null>(null);
  const [quality, setQuality] = useState<BrotliQualityName>(DEFAULT_QUALITY);
  const [compressed, setCompressed] = useState<CompressResult | null>(null);

  const [archive, setArchive] = useState<File | null>(null);
  const [decompressed, setDecompressed] = useState<DecompressResult | null>(null);

  const textInputRef = useRef<HTMLInputElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchBrotliConfig()
      .then(setConfig)
      .catch((error: unknown) => {
        log.reportError('brotli: could not read the size caps', error, { module: 'brotli' });
      });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(id);
  }, [notice]);

  const fail = (message: string) => setNotice({ kind: 'danger', text: message });
  const ok = (message: string) => setNotice({ kind: 'ok', text: message });

  /** The one place a codec failure turns into something a person can act on. */
  const explain = useCallback((error: unknown, what: string): string => {
    if (error instanceof ApiError) {
      if (error.code === 'INVALID_BROTLI') return 'That file is not valid Brotli data.';
      if (error.code === 'PAYLOAD_TOO_LARGE') return error.detail ?? 'That is past the size cap.';
      if (error.code === 'STREAM_ENDED') {
        return 'The result stopped partway through — the file is truncated, or it expands past the server’s cap.';
      }
    }
    log.reportError(`brotli: ${what} failed`, error, { module: 'brotli' });
    return `Could not ${what}.`;
  }, []);

  const runCompress = useCallback(
    async (input: { bytes: Uint8Array; name: string | null }, level: BrotliQualityName) => {
      if (input.bytes.length === 0) {
        fail('There is nothing to compress yet.');
        return;
      }
      const capBytes = config ? config.maxInputMb * 1024 * 1024 : null;
      // Fail fast before the upload, the same pre-check UploadPage makes
      // against its own cap for the same reason.
      if (capBytes !== null && input.bytes.length > capBytes) {
        fail(`That is larger than the ${config?.maxInputMb} MB limit.`);
        return;
      }

      setBusy(true);
      try {
        // Alongside, not after: the gzip number is the reason the Brotli number
        // means anything, it costs no server request at all, and running it in
        // parallel keeps a local comparison from holding back the real result.
        // Its failure is contained inside `gzipComparison` — losing a
        // comparison must never lose the result being compared.
        const [bytes, gzip] = await Promise.all([
          compressContent(input.bytes, level),
          gzipComparison(input.bytes),
        ]);
        setCompressed({
          bytes,
          sourceBytes: input.bytes.length,
          sourceName: input.name,
          quality: level,
          gzip,
        });
      } catch (error) {
        setCompressed(null);
        fail(explain(error, 'compress that'));
      } finally {
        setBusy(false);
      }
    },
    [config, explain],
  );

  // A seed arrives already chosen for compression, so it runs on arrival rather
  // than waiting behind a confirmation click — Loki→Variant's immediacy, not
  // Groot→Runestone's pre-fill-and-wait. Read once and cleared, so a refresh
  // does not silently re-apply it.
  useEffect(() => {
    const seed = takeBrotliSeed();
    if (!seed) return;
    setText(seed.text);
    setSeedFrom(seed.sourceLabel ?? null);
    setMode('compress');
    void runCompress({ bytes: new TextEncoder().encode(seed.text), name: null }, DEFAULT_QUALITY);
    // Deliberately mount-only, with no dependency on `runCompress`: the seed is
    // read once and cleared, so re-running when that callback's identity changes
    // would only ever re-compress something already consumed. The size pre-check
    // it skips (config has not loaded this early) is the server's anyway, and an
    // editor buffer is bounded far below the input cap by its own document cap.
  }, []);

  const compressCurrent = async (level: BrotliQualityName) => {
    if (sourceFile) {
      const bytes = new Uint8Array(await sourceFile.arrayBuffer());
      await runCompress({ bytes, name: sourceFile.name }, level);
      return;
    }
    await runCompress({ bytes: new TextEncoder().encode(text), name: null }, level);
  };

  /**
   * Changing the setting re-runs immediately, for the same reason arrival does:
   * once a result is on screen, picking a different quality and then having to
   * press a second button to see it is the inconsistency, not the auto-run.
   */
  const chooseQuality = (level: BrotliQualityName) => {
    setQuality(level);
    if (compressed) void compressCurrent(level);
  };

  const runDecompress = async (file: File) => {
    setBusy(true);
    try {
      const source = new Uint8Array(await file.arrayBuffer());
      const bytes = await decompressContent(source);
      const isText = looksLikeText(bytes);
      // Above the threshold nothing is rendered and no parser is started —
      // not a truncated preview, not a "detecting…" spinner.
      const readable = isText && bytes.length <= DISPLAY_MAX_BYTES;
      const body = readable ? new TextDecoder().decode(bytes) : null;
      setDecompressed({
        bytes,
        sourceBytes: source.length,
        sourceName: file.name,
        isText,
        text: body,
        format: body === null ? null : offeredFormat(body, hasModule),
      });
    } catch (error) {
      setDecompressed(null);
      fail(explain(error, 'decompress that'));
    } finally {
      setBusy(false);
    }
  };

  const copyBase64 = async (bytes: Uint8Array) => {
    if (bytes.length > COPY_MAX_BYTES) {
      fail(`Too large to copy as text — download it instead (over ${formatBytes(COPY_MAX_BYTES)}).`);
      return;
    }
    if (await copyText(toBase64(bytes))) ok('Copied as base64');
    else fail('Copy was blocked by the browser.');
  };

  const hermes = async (payload: string, bytes: number) => {
    if (bytes > COPY_MAX_BYTES) {
      fail(`Too large to send — download it instead (over ${formatBytes(COPY_MAX_BYTES)}).`);
      return;
    }
    try {
      await sendToHermes(payload);
      ok('Sent to Hermes');
    } catch (error) {
      // Hermes's own text cap is the real backstop, and its refusal is the one
      // the user should see — not a second message invented here.
      fail(error instanceof ApiError ? (error.detail ?? 'Hermes refused it.') : 'Hermes refused it.');
    }
  };

  const openIn = (format: ContentFormatEntry, body: string) => {
    format.seed(body);
    void navigate(format.route);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">ollivanders · squeeze and unsqueeze</span>
          <h2>Brotli</h2>
          <p>
            Compress text or a file with Brotli, or open a <code>.br</code> back up. The codec is
            Node’s built-in <code>zlib</code> — the same reference implementation every browser and
            the standalone <code>brotli</code> tool use, so what comes out is readable anywhere.
          </p>
        </div>
      </div>

      <div className="rune-viewtoggle brotli-modes" role="group" aria-label="Mode">
        {(['compress', 'decompress'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`rune-viewtoggle__btn${mode === value ? ' is-active' : ''}`}
            onClick={() => setMode(value)}
          >
            {value === 'compress' ? 'Compress' : 'Decompress'}
          </button>
        ))}
      </div>

      {mode === 'compress' ? (
        <Card className="brotli-panel">
          {seedFrom && <p className="caption">Sent from {seedFrom} — compressed on arrival.</p>}

          <label className="field">
            <span className="field__label">Text to compress</span>
            <textarea
              className="input brotli-input"
              rows={8}
              value={text}
              spellCheck={false}
              placeholder="Paste or type anything…"
              onChange={(event) => {
                setText(event.target.value);
                setSourceFile(null);
                setSeedFrom(null);
              }}
            />
          </label>

          <div className="brotli-row">
            <Button size="sm" variant="ghost" onClick={() => textInputRef.current?.click()}>
              {sourceFile ? `File: ${sourceFile.name}` : 'Or choose a file…'}
            </Button>
            {sourceFile && (
              <span className="caption">{formatBytes(sourceFile.size)} — the text box is ignored</span>
            )}
            <input
              ref={textInputRef}
              type="file"
              hidden
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setSourceFile(picked);
                setSeedFrom(null);
                event.target.value = '';
              }}
            />
          </div>

          <fieldset className="brotli-quality">
            <legend className="field__label">Quality</legend>
            {QUALITIES.map((option) => (
              <label key={option.name} className="brotli-quality__option">
                <input
                  type="radio"
                  name="brotli-quality"
                  value={option.name}
                  checked={quality === option.name}
                  onChange={() => chooseQuality(option.name)}
                />
                <span>
                  <strong>{option.label}</strong> <span className="caption">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="brotli-row">
            <Button
              disabled={busy || (sourceFile === null && text.trim() === '')}
              onClick={() => void compressCurrent(quality)}
            >
              {busy ? 'Compressing…' : 'Compress'}
            </Button>
            {config && (
              <span className="caption">Up to {config.maxInputMb} MB per file.</span>
            )}
          </div>

          {compressed && (
            <div className="brotli-result">
              <p className="brotli-sizes">
                <strong>{formatBytes(compressed.sourceBytes)}</strong> →{' '}
                <strong>{formatBytes(compressed.bytes.length)}</strong>{' '}
                <span className="caption">
                  ({savedPercent(compressed.sourceBytes, compressed.bytes.length)}% smaller with
                  Brotli, {qualityLabel(compressed.quality)})
                </span>
              </p>

              {compressed.gzip && (
                <p className="brotli-sizes">
                  gzip for comparison: <strong>{formatBytes(compressed.gzip.size)}</strong>{' '}
                  <span className="caption">
                    ({savedPercent(compressed.sourceBytes, compressed.gzip.size)}% smaller —
                    computed in this browser, no request)
                  </span>
                </p>
              )}

              <div className="brotli-row">
                <Button
                  size="sm"
                  onClick={() =>
                    saveBlob(
                      new Blob([compressed.bytes as BlobPart]),
                      compressedName(compressed.sourceName),
                    )
                  }
                >
                  Download .br
                </Button>
                {compressed.gzip && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      saveBlob(
                        compressed.gzip?.blob ?? new Blob(),
                        gzippedName(compressed.sourceName),
                      )
                    }
                  >
                    Download .gz
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => void copyBase64(compressed.bytes)}>
                  Copy as base64
                </Button>
                {hasModule('clipboard') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Put it on the shared clipboard board"
                    onClick={() =>
                      void hermes(toBase64(compressed.bytes), compressed.bytes.length)
                    }
                  >
                    Send to Hermes
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card className="brotli-panel">
          <div className="brotli-row">
            <Button size="sm" variant="ghost" onClick={() => archiveInputRef.current?.click()}>
              {archive ? `File: ${archive.name}` : 'Choose a .br file…'}
            </Button>
            {archive && <span className="caption">{formatBytes(archive.size)}</span>}
            <input
              ref={archiveInputRef}
              type="file"
              hidden
              onChange={(event) => {
                const picked = event.target.files?.[0] ?? null;
                setArchive(picked);
                setDecompressed(null);
                event.target.value = '';
              }}
            />
            <Button
              disabled={busy || archive === null}
              onClick={() => archive && void runDecompress(archive)}
            >
              {busy ? 'Decompressing…' : 'Decompress'}
            </Button>
          </div>
          {config && (
            <p className="caption">
              Results are capped at {config.maxOutputMb} MB — a small <code>.br</code> can expand a
              very long way, so the server stops rather than following it.
            </p>
          )}

          {decompressed && (
            <div className="brotli-result">
              <p className="brotli-sizes">
                <strong>{formatBytes(decompressed.sourceBytes)}</strong> →{' '}
                <strong>{formatBytes(decompressed.bytes.length)}</strong>{' '}
                <span className="caption">
                  {decompressed.isText ? 'text' : 'binary — shown as a download only'}
                </span>
              </p>

              <div className="brotli-row">
                <Button
                  size="sm"
                  onClick={() =>
                    saveBlob(
                      new Blob([decompressed.bytes as BlobPart]),
                      decompressedName(decompressed.sourceName, decompressed.isText),
                    )
                  }
                >
                  Download
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void copyBase64(decompressed.bytes)}
                >
                  Copy as base64
                </Button>
                {hasModule('clipboard') && decompressed.text !== null && (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Put it on the shared clipboard board"
                    onClick={() =>
                      void hermes(decompressed.text ?? '', decompressed.bytes.length)
                    }
                  >
                    Send to Hermes
                  </Button>
                )}
                {decompressed.format && decompressed.text !== null && (
                  <Button
                    size="sm"
                    onClick={() => {
                      if (decompressed.format && decompressed.text !== null) {
                        openIn(decompressed.format, decompressed.text);
                      }
                    }}
                  >
                    {decompressed.format.icon} Open in {decompressed.format.toolName}
                  </Button>
                )}
              </div>

              {decompressed.text === null ? (
                <p className="caption">
                  {decompressed.isText
                    ? `Over ${formatBytes(DISPLAY_MAX_BYTES)} — not shown here, and no format check was run on it.`
                    : 'This is binary data, so there is nothing to show or open.'}
                </p>
              ) : (
                <pre className="brotli-preview">{decompressed.text.slice(0, 20000)}</pre>
              )}
            </div>
          )}
        </Card>
      )}

      <p className="caption brotli-footer">
        Quality {qualityLevel(quality)} ({qualityLabel(quality)}) · standard window, never
        large-window — so any Brotli decoder can read what this page produces.
      </p>

      {notice && (
        <Toast kind={notice.kind} floating>
          {notice.kind === 'danger' && <AlertIcon size={14} />} {notice.text}
        </Toast>
      )}

      {!config && (
        <p className="caption">
          <ArchiveFileIcon size={14} /> Reading the server’s size limits…
        </p>
      )}
    </>
  );
}

/**
 * The gzip side of the comparison, or null. Absent rather than broken wherever
 * `CompressionStream` is missing — the same posture the SHA-256 toolbox tool
 * takes for `crypto.subtle` — and absent rather than fatal if the browser has
 * the API but refuses the work: this panel exists to put Brotli's number in
 * context, and a missing context is not a reason to throw the number away.
 */
async function gzipComparison(bytes: Uint8Array): Promise<{ size: number; blob: Blob } | null> {
  if (!hasCompressionStream()) return null;
  try {
    return await gzipBytes(bytes);
  } catch (error) {
    log.reportError('brotli: gzip comparison failed', error, { module: 'brotli' });
    return null;
  }
}

/** Only offer a tool this deploy profile actually serves. */
function offeredFormat(
  body: string,
  hasModule: (module: string) => boolean,
): ContentFormatEntry | null {
  const match = detectFormat(body);
  return match && hasModule(match.module) ? match : null;
}
