import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  beautifyJs,
  checkJsSyntax,
  convertQuotes,
  curlToFetch,
  destringifyJs,
  htmlEscape,
  htmlUnescape,
  isSingleStringLiteral,
  minifyJs,
  stringifyJs,
  stripComments,
  unwrapIife,
  uriDecode,
  uriEncode,
  wrapIife,
  type JsSyntaxError,
} from '../../core/js';
import { formatBytes } from '../../core/format';
import { putVariantTextSeed } from '../../core/variantSeed';
import { usePanelFont } from '../../core/panelFont';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { Toast } from '../../core/ui/Toast';
import { AlertIcon, CheckIcon, CodeIcon } from '../../core/ui/icons';
import { PanelFontControl, UndoRedoControl } from '../../core/ui/PanelControls';
import { JsonEditor, type DiffHighlight, type JsonEditorHandle } from '../../core/ui/JsonEditor';
import { runRegex } from './regex';
import { loadLokiDraft, saveLokiDraft } from './draft';

const EDITOR_PLACEHOLDER = 'Paste, type, or transform JavaScript…';
const REGEX_PLACEHOLDER = 'Text to test the pattern against…';

type Mode = 'transforms' | 'regex';

const initialDraft = loadLokiDraft();

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

interface RailAction {
  label: string;
  hint: string;
  run: () => void | Promise<void>;
  disabled?: boolean;
}

interface RailGroup {
  id: string;
  label: string;
  actions: RailAction[];
}

export function LokiPage() {
  const navigate = useNavigate();
  const font = usePanelFont();

  const [mode, setMode] = useState<Mode>(initialDraft?.mode ?? 'transforms');

  // Transforms workspace ----------------------------------------------------
  const [code, setCode] = useState(initialDraft?.code ?? '');
  const [busy, setBusy] = useState(false);
  const [minifyInfo, setMinifyInfo] = useState<{ before: number; after: number } | null>(null);
  const [beforeSnapshot, setBeforeSnapshot] = useState<string | null>(null);
  const [syntaxError, setSyntaxError] = useState<JsSyntaxError | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; message: string } | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const editorRef = useRef<JsonEditorHandle>(null);

  // Regex workspace (separate — survives mode toggles) ----------------------
  const [rxPattern, setRxPattern] = useState(initialDraft?.rxPattern ?? '');
  const [rxFlags, setRxFlags] = useState(initialDraft?.rxFlags ?? 'g');
  const [rxSubject, setRxSubject] = useState(initialDraft?.rxSubject ?? '');

  const ok = (message: string) => setNotice({ kind: 'ok', message });
  const fail = (message: string) => setNotice({ kind: 'danger', message });

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(id);
  }, [notice]);

  // Cache the whole workspace (debounced) so navigating to Variant and back —
  // or a mid-edit refresh — loses nothing.
  useEffect(() => {
    const id = window.setTimeout(
      () => saveLokiDraft({ code, mode, rxPattern, rxFlags, rxSubject }),
      400,
    );
    return () => window.clearTimeout(id);
  }, [code, mode, rxPattern, rxFlags, rxSubject]);

  // Syntax banner (acorn, lazy + debounced off the keystroke path).
  const debouncedCode = useDebounced(code, 350);
  useEffect(() => {
    let cancelled = false;
    void checkJsSyntax(debouncedCode).then((err) => {
      if (!cancelled) setSyntaxError(err);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedCode]);

  const empty = code.trim() === '';
  const stats = useMemo(() => {
    const bytes = new TextEncoder().encode(code).length;
    const lines = code === '' ? 0 : code.split('\n').length;
    return { bytes, lines };
  }, [code]);

  // ── transform plumbing ────────────────────────────────────────────────────
  // A refused transform leaves the buffer byte-identical; an applied one is a
  // single CM-history undo away (applyEdit commits a minimal change).
  const commit = (next: string, okMsg?: string) => {
    if (next !== code) {
      setBeforeSnapshot(code);
      setMinifyInfo(null);
    }
    editorRef.current?.applyEdit(() => ({ doc: next, from: 0, to: 0 }));
    if (okMsg) ok(okMsg);
  };

  const applyTransform = (fn: (input: string) => string, okMsg: string) => {
    try {
      commit(fn(code), okMsg);
    } catch (error) {
      fail((error as Error).message || 'That transform could not run.');
    }
  };

  const runBeautify = async () => {
    setBusy(true);
    try {
      const next = await beautifyJs(code, { tabWidth: 2, singleQuote: true, semi: true });
      commit(next.replace(/\n$/, ''), 'Beautified');
    } catch (error) {
      fail(`Could not beautify — ${shortError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const runMinify = async () => {
    setBusy(true);
    try {
      const result = await minifyJs(code, { mangle: true });
      if (result.code !== code) setBeforeSnapshot(code);
      editorRef.current?.applyEdit(() => ({ doc: result.code, from: 0, to: 0 }));
      setMinifyInfo({ before: result.beforeBytes, after: result.afterBytes });
      ok('Minified');
    } catch (error) {
      fail(`Could not minify — ${shortError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const runCurl = () => {
    try {
      const { code: out, unsupported } = curlToFetch(code);
      setBeforeSnapshot(code);
      setMinifyInfo(null);
      editorRef.current?.applyEdit(() => ({ doc: out, from: 0, to: 0 }));
      if (unsupported.length > 0) fail(`Converted — unsupported flags: ${unsupported.join(', ')}`);
      else ok('Converted cURL to fetch');
    } catch {
      fail('Could not parse that as a cURL command.');
    }
  };

  const diffInVariant = () => {
    if (beforeSnapshot === null) return;
    putVariantTextSeed({ left: beforeSnapshot, right: code });
    navigate('/variant');
  };

  const clearAll = () => {
    if (!empty && !window.confirm('Clear the buffer?')) return;
    editorRef.current?.applyEdit(() => ({ doc: '', from: 0, to: 0 }));
    setBeforeSnapshot(null);
    setMinifyInfo(null);
  };

  const groups: RailGroup[] = useMemo(() => {
    const needsValid = busy || empty || syntaxError !== null;
    const canDiff = beforeSnapshot !== null && beforeSnapshot !== code;
    return [
      {
        id: 'format',
        label: 'Format',
        actions: [
          { label: 'Beautify', hint: 'Prettier — reformat the code', run: runBeautify, disabled: needsValid },
          { label: 'Minify', hint: 'Terser — compress + mangle', run: runMinify, disabled: needsValid },
        ],
      },
      {
        id: 'strings',
        label: 'Strings',
        actions: [
          { label: 'Stringify', hint: 'Wrap the buffer in a string literal', run: () => {
            if (isSingleStringLiteral(code)) {
              fail('Already a string literal — use Destringify to unwrap.');
              return;
            }
            applyTransform((c) => stringifyJs(c, 'double'), 'Wrapped as a string literal');
          }, disabled: empty },
          { label: 'Destringify', hint: 'Unwrap a quoted string literal', run: () => applyTransform((c) => destringifyJs(c), 'Unwrapped the string literal'), disabled: empty },
          { label: 'Escape HTML', hint: 'Encode & < > " \'', run: () => applyTransform(htmlEscape, 'HTML-escaped'), disabled: empty },
          { label: 'Unescape HTML', hint: 'Decode HTML entities', run: () => applyTransform(htmlUnescape, 'HTML-unescaped'), disabled: empty },
          { label: 'URL encode', hint: 'encodeURIComponent', run: () => applyTransform(uriEncode, 'URL-encoded'), disabled: empty },
          { label: 'URL decode', hint: 'decodeURIComponent', run: () => applyTransform(uriDecode, 'URL-decoded'), disabled: empty },
        ],
      },
      {
        id: 'convert',
        label: 'Convert',
        actions: [
          { label: "To ' quotes", hint: 'Double → single (literal-aware)', run: () => applyTransform((c) => convertQuotes(c, 'single'), 'Converted to single quotes'), disabled: empty },
          { label: 'To " quotes', hint: 'Single → double (literal-aware)', run: () => applyTransform((c) => convertQuotes(c, 'double'), 'Converted to double quotes'), disabled: empty },
          { label: 'cURL → fetch', hint: 'Turn a cURL command into fetch()', run: runCurl, disabled: empty },
          { label: 'Wrap IIFE', hint: 'Wrap in (() => { … })()', run: () => applyTransform(wrapIife, 'Wrapped in an IIFE'), disabled: empty },
          { label: 'Unwrap IIFE', hint: 'Unwrap a wrapping IIFE', run: () => applyTransform(unwrapIife, 'Unwrapped the IIFE'), disabled: empty },
        ],
      },
      {
        id: 'clean',
        label: 'Clean',
        actions: [
          { label: 'Strip comments', hint: 'Remove // and /* */ comments', run: () => applyTransform(stripComments, 'Comments stripped'), disabled: empty },
          { label: 'Diff before/after', hint: 'Compare the last transform in Variant', run: diffInVariant, disabled: !canDiff },
        ],
      },
    ];
    // Actions capture current state via closure; rebuild when inputs change.
  }, [code, busy, empty, syntaxError, beforeSnapshot]);

  // ── regex compute ─────────────────────────────────────────────────────────
  const rxOutcome = useMemo(() => runRegex(rxPattern, rxFlags, rxSubject), [rxPattern, rxFlags, rxSubject]);
  const rxHighlights: DiffHighlight[] = useMemo(
    () => rxOutcome.matches.map((m) => ({ from: m.index, to: m.end, kind: 'add', level: 'char' as const })),
    [rxOutcome],
  );

  const panelStyle = { '--panel-font': `${font.px}px` } as CSSProperties;

  return (
    <>
      <div className="page-head loki-head">
        <div>
          <span className="eyebrow eyebrow--violet">loki · the shape of code changes</span>
          <h2>
            <CodeIcon size={26} /> Loki
          </h2>
          <p>Beautify, minify, and reshape JavaScript — or test a pattern in Regex mode.</p>
        </div>
        <div className="loki-modetoggle" role="group" aria-label="Loki mode">
          <button
            type="button"
            className={`loki-modetoggle__btn${mode === 'transforms' ? ' is-active' : ''}`}
            onClick={() => setMode('transforms')}
          >
            Transforms
          </button>
          <button
            type="button"
            className={`loki-modetoggle__btn${mode === 'regex' ? ' is-active' : ''}`}
            onClick={() => setMode('regex')}
          >
            Regex
          </button>
        </div>
      </div>

      <div className="stack loki-workspace panel-scope" style={panelStyle}>
        {mode === 'transforms' ? (
          <Card>
            {/* Mobile: group chips open a bottom sheet. Desktop: inline rail. */}
            <div className="loki-sheetbar" role="toolbar" aria-label="Transform groups">
              {groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className="loki-chip"
                  onClick={() => setOpenGroup(group.id)}
                >
                  {group.label}
                </button>
              ))}
              <span className="loki-sheetbar__controls">
                <UndoRedoControl editor={editorRef} disabled={empty} />
                <PanelFontControl font={font} />
              </span>
            </div>

            <div className="loki-body">
              <aside className="loki-rail" aria-label="Transforms">
                <div className="loki-rail__fontrow">
                  <UndoRedoControl editor={editorRef} disabled={empty} />
                  <PanelFontControl font={font} />
                </div>
                {groups.map((group) => (
                  <div key={group.id} className="loki-rail__group">
                    <span className="caption loki-rail__grouplabel">{group.label}</span>
                    <div className="loki-rail__actions">
                      {group.actions.map((action) => (
                        <Button
                          key={action.label}
                          size="sm"
                          variant="ghost"
                          disabled={action.disabled}
                          title={action.hint}
                          onClick={() => void action.run()}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="loki-rail__group">
                  <span className="caption loki-rail__grouplabel">Buffer</span>
                  <div className="loki-rail__actions">
                    <Button size="sm" variant="ghost" disabled={empty} onClick={clearAll}>
                      Clear
                    </Button>
                  </div>
                </div>
              </aside>

              <div className="loki-editorwrap">
                {syntaxError ? (
                  <div className="loki-banner loki-banner--bad" role="status">
                    <AlertIcon size={14} /> {syntaxError.line}:{syntaxError.column} — {syntaxError.message}
                  </div>
                ) : !empty ? (
                  <div className="loki-banner loki-banner--ok" role="status">
                    <CheckIcon size={14} /> Parses cleanly
                  </div>
                ) : null}

                <JsonEditor
                  ref={editorRef}
                  value={code}
                  onChange={setCode}
                  javascript
                  height="var(--loki-editor-h, 56vh)"
                  placeholder={EDITOR_PLACEHOLDER}
                />

                <div className="loki-status" aria-live="polite">
                  <span className="caption">
                    {formatBytes(stats.bytes)} · {stats.lines} {stats.lines === 1 ? 'line' : 'lines'}
                  </span>
                  {busy && <span className="caption">Working…</span>}
                  {minifyInfo && (
                    <span className="caption loki-status__minify">
                      {formatBytes(minifyInfo.before)} → {formatBytes(minifyInfo.after)}
                      {minifyInfo.before > 0 && (
                        <> ({Math.round((1 - minifyInfo.after / minifyInfo.before) * 100)}% smaller)</>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="loki-regex">
              <div className="loki-regex__inputs">
                <label className="loki-regex__field loki-regex__field--pattern">
                  <span className="caption">Pattern</span>
                  <div className="loki-regex__patternrow">
                    <span className="loki-regex__slash">/</span>
                    <input
                      className="loki-regex__input mono"
                      value={rxPattern}
                      spellCheck={false}
                      placeholder="\bword\b"
                      onChange={(event) => setRxPattern(event.target.value)}
                    />
                    <span className="loki-regex__slash">/</span>
                    <input
                      className="loki-regex__flags mono"
                      value={rxFlags}
                      spellCheck={false}
                      aria-label="Flags"
                      placeholder="gim"
                      onChange={(event) => setRxFlags(event.target.value.replace(/[^gimsuyd]/g, ''))}
                    />
                  </div>
                </label>
                <span className="loki-regex__count caption">
                  {rxOutcome.error
                    ? 'invalid pattern'
                    : rxOutcome.empty
                      ? 'enter a pattern'
                      : `${rxOutcome.matches.length} ${rxOutcome.matches.length === 1 ? 'match' : 'matches'}`}
                </span>
              </div>

              {rxOutcome.error && (
                <div className="loki-banner loki-banner--bad" role="alert">
                  <AlertIcon size={14} /> {rxOutcome.error}
                </div>
              )}

              <JsonEditor
                value={rxSubject}
                onChange={setRxSubject}
                plain
                highlights={rxHighlights}
                height="var(--loki-editor-h, 40vh)"
                placeholder={REGEX_PLACEHOLDER}
              />

              {rxOutcome.matches.length > 0 && (
                <div className="loki-regex__results">
                  <table className="loki-regex__table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Match</th>
                        <th>Groups</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rxOutcome.matches.slice(0, 100).map((m, i) => (
                        <tr key={`${m.index}-${i}`}>
                          <td className="mono">{i + 1}</td>
                          <td className="mono loki-regex__matchtext">{m.text || '∅'}</td>
                          <td className="mono">
                            {m.groups.length === 0 ? (
                              <span className="caption">—</span>
                            ) : (
                              m.groups.map((g, gi) => (
                                <span key={gi} className="loki-regex__group">
                                  {gi + 1}: {g === undefined ? '∅' : g}
                                </span>
                              ))
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rxOutcome.matches.length > 100 && (
                    <p className="caption">…and {rxOutcome.matches.length - 100} more</p>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}

        {notice && <Toast kind={notice.kind}>{notice.message}</Toast>}

        <p className="loki-soon caption">
          Coming to Loki: <strong>Calcifer</strong> — run snippets in a killable sandbox with a
          console drawer (local network only).
        </p>
      </div>

      {/* Mobile bottom-sheet for a group's actions. */}
      {openGroup && (
        <div className="loki-sheet-scrim" onClick={() => setOpenGroup(null)}>
          <div className="loki-sheet" role="dialog" aria-label="Transform actions" onClick={(e) => e.stopPropagation()}>
            <div className="loki-sheet__head">
              <strong>{groups.find((g) => g.id === openGroup)?.label}</strong>
              <button type="button" className="loki-sheet__close" onClick={() => setOpenGroup(null)}>
                Done
              </button>
            </div>
            <div className="loki-sheet__actions">
              {groups
                .find((g) => g.id === openGroup)
                ?.actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className="loki-sheet__action"
                    disabled={action.disabled}
                    onClick={() => {
                      setOpenGroup(null);
                      void action.run();
                    }}
                  >
                    <span>{action.label}</span>
                    <span className="caption">{action.hint}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function shortError(error: unknown): string {
  const message = (error as Error)?.message ?? 'error';
  return (message.split('\n')[0] ?? message).slice(0, 120);
}
