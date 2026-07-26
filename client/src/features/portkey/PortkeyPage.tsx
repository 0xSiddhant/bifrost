import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../../core/api';
import { copyText } from '../../core/copy';
import { deviceName } from '../../core/devices';
import { formatTimeAgo } from '../../core/format';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { EmptyState } from '../../core/ui/EmptyState';
import { QrCard } from '../../core/ui/QrCard';
import {
  CheckIcon,
  ClipboardIcon,
  CloseIcon,
  PencilIcon,
  QrIcon,
  SearchIcon,
  WandIcon,
} from '../../core/ui/icons';
import { createPortkey, deletePortkey, goPath, goUrl, updatePortkey, type Portkey } from './api';
import { isValidSlugFormat, slugFormatError } from './slug';
import { usePortkeys } from './usePortkeys';
import './portkey.css';

/** The inline editor a row expands into — target and note; the slug is fixed. */
function EditRow({ link, onDone }: { link: Portkey; onDone: () => void }) {
  const [url, setUrl] = useState(link.url);
  const [note, setNote] = useState(link.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      await updatePortkey(link.slug, { url: url.trim(), note: note.trim() });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.detail ? err.detail : 'Could not save that change.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pk-edit">
      <label className="field">
        <span className="field__label">Target</span>
        <input
          className="field__input"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          autoFocus
        />
      </label>
      <label className="field">
        <span className="field__label">Note</span>
        <input
          className="field__input"
          value={note}
          maxLength={200}
          placeholder="Optional"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {error && (
        <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      <div className="row">
        <Button size="sm" onClick={() => void commit()} disabled={busy || url.trim().length === 0}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Portkey — LAN go-links (PLAN-15). Create memorable `bifrost.local/go/<word>`
 * redirects to anything on the network; the page is the place to make, edit and
 * watch them (hit counts + last-used update live), each with its own QR.
 */
export function PortkeyPage() {
  const { links, ready, error } = usePortkeys();
  const [searchParams, setSearchParams] = useSearchParams();

  // Creative-404 hand-off: `/go/<missing>` bounces here with `?go=<slug>` so the
  // form arrives pre-filled with the word the person just tried to reach.
  const [slug, setSlug] = useState(() => searchParams.get('go') ?? '');
  const [enchantSlug, setEnchantSlug] = useState(() => searchParams.get('go'));
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [conflictSlug, setConflictSlug] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [confirmSlug, setConfirmSlug] = useState<string | null>(null);
  const [qrSlug, setQrSlug] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Consume the `?go=` param once on mount so a refresh doesn't keep
  // re-triggering it (the slug/banner are already seeded from it in state).
  const consumedGo = useRef(false);
  useEffect(() => {
    if (consumedGo.current) return;
    consumedGo.current = true;
    if (searchParams.has('go')) {
      const next = new URLSearchParams(searchParams);
      next.delete('go');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // The enchant banner resolves itself if that slug now exists (e.g. it was just
  // created, here or elsewhere).
  const enchantPending = enchantSlug !== null && !links.some((link) => link.slug === enchantSlug);

  const slugError = slugFormatError(slug);
  const canEnchant = isValidSlugFormat(slug) && url.trim().length > 0 && !saving;

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return links;
    return links.filter(
      (link) =>
        link.slug.includes(query) ||
        link.url.toLowerCase().includes(query) ||
        (link.note ?? '').toLowerCase().includes(query),
    );
  }, [links, q]);

  const enchant = async () => {
    if (!canEnchant) return;
    setSaving(true);
    setCreateError(null);
    setConflictSlug(null);
    try {
      await createPortkey({ slug: slug.trim(), url: url.trim(), note: note.trim() || undefined });
      // The row arrives over SSE; clearing here is the make-another loop.
      setSlug('');
      setUrl('');
      setNote('');
      setEnchantSlug(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictSlug(slug.trim());
        setCreateError(err.detail ?? `/go/${slug.trim()} is already enchanted.`);
      } else if (err instanceof ApiError && err.detail) {
        setCreateError(err.detail);
      } else {
        setCreateError('Could not enchant that portkey.');
      }
    } finally {
      setSaving(false);
    }
  };

  const viewConflict = () => {
    if (conflictSlug) setQ(conflictSlug);
    setConflictSlug(null);
    setCreateError(null);
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const copy = async (link: Portkey) => {
    if (await copyText(goUrl(link.slug))) {
      setCopiedSlug(link.slug);
      window.setTimeout(() => setCopiedSlug((s) => (s === link.slug ? null : s)), 1500);
    }
  };

  const remove = async (link: Portkey) => {
    setConfirmSlug(null);
    await deletePortkey(link.slug).catch(() => {});
  };

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow eyebrow--violet">portkey · a word that carries you there</span>
          <h2>Portkey</h2>
          <p>
            Short, memorable links for everything on the network. Touch{' '}
            <span className="mono">bifrost.local/go/router</span> and land on the router.
          </p>
        </div>
      </div>

      <div className="stack pk-wrap">
        <Card>
          {enchantPending && (
            <div className="pk-enchant-note" role="status">
              <WandIcon size={18} />
              <span>
                <strong className="mono">/go/{enchantSlug}</strong> was never enchanted. Give it a
                target below and it will carry you there next time.
              </span>
            </div>
          )}

          <div className="pk-add">
            <label className="field pk-add__slug">
              <span className="field__label">Go-link</span>
              <div className={`pk-slug-input${slugError ? ' pk-slug-input--bad' : ''}`}>
                <span className="pk-slug-prefix mono" aria-hidden="true">
                  /go/
                </span>
                <input
                  className="field__input"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="router"
                  value={slug}
                  maxLength={32}
                  onChange={(event) => {
                    setSlug(event.target.value);
                    setCreateError(null);
                    setConflictSlug(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void enchant();
                  }}
                />
              </div>
            </label>
            <label className="field pk-add__url">
              <span className="field__label">Target</span>
              <input
                className="field__input"
                inputMode="url"
                autoComplete="off"
                placeholder="192.168.1.1  ·  http://nas.local:5000  ·  https://…"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setCreateError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void enchant();
                }}
              />
            </label>
            <label className="field pk-add__note">
              <span className="field__label">Note (optional)</span>
              <input
                className="field__input"
                autoComplete="off"
                placeholder="what it points at"
                value={note}
                maxLength={200}
                onChange={(event) => setNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void enchant();
                }}
              />
            </label>
            <Button onClick={() => void enchant()} disabled={!canEnchant}>
              {saving ? 'Enchanting…' : 'Enchant'}
            </Button>
          </div>

          {slugError && (
            <p className="caption pk-hint" role="status">
              {slugError}
            </p>
          )}
          {createError && (
            <p className="caption pk-error" role="alert">
              {createError}
              {conflictSlug && (
                <button type="button" className="pk-linkbtn" onClick={viewConflict}>
                  View it
                </button>
              )}
            </p>
          )}
          {!slugError && !createError && (
            <p className="caption pk-hint">
              Targets can point anywhere on the LAN or the web — the redirect is always instant.
            </p>
          )}
        </Card>

        {links.length > 1 && (
          <label className="pk-search">
            <SearchIcon size={15} />
            <input
              className="field__input"
              type="search"
              placeholder="Search go-links, targets and notes…"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            <span className="pk-count caption">
              {visible.length === links.length
                ? `${links.length} portkeys`
                : `${visible.length} of ${links.length}`}
            </span>
          </label>
        )}

        {error && (
          <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
            The portkeys could not be read. Check the bridge and reload.
          </p>
        )}

        {ready && links.length === 0 && !error && (
          <EmptyState
            icon={<WandIcon size={28} />}
            title="No portkeys yet"
            hint="Enchant one above — then bifrost.local/go/<your-word> jumps straight there, from any device."
          />
        )}

        {ready && links.length > 0 && visible.length === 0 && (
          <EmptyState
            icon={<SearchIcon size={28} />}
            title="Nothing matches"
            hint="No portkey matches that search."
          />
        )}

        {visible.length > 0 && (
          <div className="pk-grid" ref={gridRef}>
            {visible.map((link) => {
              const who = deviceName(link.authorDeviceId);
              return (
                <article className="pk-card" key={link.slug}>
                  <div className="pk-card__head">
                    <a
                      className="pk-card__slug mono"
                      href={goPath(link.slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Open ${goUrl(link.slug)}`}
                    >
                      /go/{link.slug}
                    </a>
                    <span className="pk-card__hits" title="Redirects">
                      {link.hits} {link.hits === 1 ? 'hit' : 'hits'}
                    </span>
                  </div>

                  <a
                    className="pk-card__target"
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={link.url}
                  >
                    {link.url}
                  </a>

                  {link.note && <p className="pk-card__note">{link.note}</p>}

                  <div className="pk-card__meta caption">
                    <span>{link.lastUsedAt ? `used ${formatTimeAgo(link.lastUsedAt)}` : 'never used'}</span>
                    {who && <span className="pk-card__who">{who}</span>}
                  </div>

                  {qrSlug === link.slug && (
                    <div className="pk-card__qr">
                      <QrCard
                        text={goUrl(link.slug)}
                        size={168}
                        label={`QR to /go/${link.slug}`}
                        downloadName={`portkey-${link.slug}.png`}
                      />
                      <span className="caption">Scan on a phone — it lands through the redirect.</span>
                    </div>
                  )}

                  {editingSlug === link.slug && (
                    <EditRow link={link} onDone={() => setEditingSlug(null)} />
                  )}

                  {confirmSlug === link.slug && (
                    <div className="pk-confirm" role="alert">
                      <span className="caption">Remove /go/{link.slug}?</span>
                      <Button size="sm" variant="danger" onClick={() => void remove(link)}>
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmSlug(null)}>
                        Keep
                      </Button>
                    </div>
                  )}

                  <div className="pk-card__actions">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={qrSlug === link.slug ? 'Hide QR' : `Show QR for /go/${link.slug}`}
                      aria-pressed={qrSlug === link.slug}
                      onClick={() => setQrSlug((s) => (s === link.slug ? null : link.slug))}
                    >
                      <QrIcon size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={copiedSlug === link.slug ? 'Copied' : `Copy ${goUrl(link.slug)}`}
                      onClick={() => void copy(link)}
                    >
                      {copiedSlug === link.slug ? <CheckIcon size={15} /> : <ClipboardIcon size={15} />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit /go/${link.slug}`}
                      onClick={() => {
                        setConfirmSlug(null);
                        setEditingSlug((s) => (s === link.slug ? null : link.slug));
                      }}
                    >
                      <PencilIcon size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete /go/${link.slug}`}
                      onClick={() => {
                        setEditingSlug(null);
                        setConfirmSlug((s) => (s === link.slug ? null : link.slug));
                      }}
                    >
                      <CloseIcon size={15} />
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
