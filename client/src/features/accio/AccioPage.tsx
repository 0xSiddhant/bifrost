import { useMemo, useState } from 'react';
import { ApiError } from '../../core/api';
import { deleteLink, saveLink, updateLink, type AccioLink } from '../../core/accio';
import { copyText } from '../../core/copy';
import { deviceName } from '../../core/devices';
import { formatTimeAgo } from '../../core/format';
import { Button } from '../../core/ui/Button';
import { Card } from '../../core/ui/Card';
import { cardToneClass } from '../../core/ui/cardTone';
import { EmptyState } from '../../core/ui/EmptyState';
import {
  CheckIcon,
  ClipboardIcon,
  CloseIcon,
  PencilIcon,
  SearchIcon,
  SparklesIcon,
} from '../../core/ui/icons';
import {
  allTags,
  displayTitle,
  filterLinks,
  hostnameOf,
  parseTagInput,
  sortLinks,
  tileLetter,
  tileTone,
  type ShelfSort,
} from './shelf';
import { TagField } from './TagField';
import { useShelf } from './useShelf';

const SORTS: Array<{ value: ShelfSort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'title', label: 'A–Z' },
];

/** The inline editor a row expands into — title and tags, nothing else. */
function EditRow({
  link,
  known,
  onDone,
}: {
  link: AccioLink;
  known: readonly string[];
  onDone: () => void;
}) {
  const [title, setTitle] = useState(link.title ?? '');
  const [tags, setTags] = useState(link.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateLink(link.id, { title: title.trim(), tags: parseTagInput(tags) });
      onDone();
    } catch {
      setError('Could not save that change.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shelf-edit">
      <label className="field">
        <span className="field__label">Title</span>
        <input
          className="field__input"
          value={title}
          maxLength={200}
          placeholder="Leave empty to show the address"
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />
      </label>
      <TagField label="Tags" value={tags} onChange={setTags} known={known} placeholder="comma, separated" />
      {error && (
        <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      <div className="row">
        <Button size="sm" onClick={() => void commit()} disabled={busy}>
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
 * Accio — the read-later shelf (PLAN-13). Distinct from Hermes by intent:
 * Hermes *passes* things between devices and forgets them; Accio *summons* them
 * back later.
 */
export function AccioPage() {
  const { links, ready, error } = useShelf();

  const [url, setUrl] = useState('');
  const [newTags, setNewTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<ShelfSort>('newest');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const tags = useMemo(() => allTags(links), [links]);
  const visible = useMemo(
    () => sortLinks(filterLinks(links, { q, tag }), sort),
    [links, q, tag, sort],
  );

  const summon = async () => {
    const candidate = url.trim();
    if (!candidate) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveLink({ url: candidate, tags: parseTagInput(newTags) });
      // The row arrives over SSE; clearing here is just the paste-and-go loop.
      setUrl('');
      setNewTags('');
    } catch (err) {
      setSaveError(
        err instanceof ApiError && err.status === 422
          ? "That isn't an address Accio can keep."
          : 'Could not save that link.',
      );
    } finally {
      setSaving(false);
    }
  };

  const copy = async (link: AccioLink) => {
    if (await copyText(link.url)) {
      setCopiedId(link.id);
      window.setTimeout(() => setCopiedId((id) => (id === link.id ? null : id)), 1500);
    }
  };

  const remove = async (link: AccioLink) => {
    setConfirmId(null);
    // The row leaves via the accio.deleted event, here and on every other device.
    await deleteLink(link.id).catch(() => {});
  };

  return (
    <>
      <div className="page-head accio-head">
        <div>
          <span className="eyebrow eyebrow--violet">accio · summon it back later</span>
          <h2>Accio</h2>
          <p>A shelf for links worth keeping. Save from any device, open from any other.</p>
        </div>
      </div>

      <div className="stack accio-wrap">
        <Card>
          <div className="shelf-add">
            <label className="field shelf-add__url">
              <span className="field__label">Save a link</span>
              <input
                className="field__input"
                inputMode="url"
                autoComplete="off"
                placeholder="Paste a URL and press Enter…"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  // The complaint was about what was typed before — the moment
                  // it changes, the complaint is stale.
                  setSaveError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void summon();
                }}
              />
            </label>
            <div className="shelf-add__tags">
              <TagField
                label="Tags (optional)"
                value={newTags}
                onChange={setNewTags}
                known={tags}
                placeholder="comma, separated"
                onSubmit={() => void summon()}
              />
            </div>
            <Button onClick={() => void summon()} disabled={saving || url.trim().length === 0}>
              {saving ? 'Summoning…' : 'Accio'}
            </Button>
          </div>
          {saveError && (
            <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
              {saveError}
            </p>
          )}
          <p className="caption shelf-add__hint">
            No title? Bifrost fetches the page for one — the link is shelved either way.
          </p>
        </Card>

        {links.length > 0 && (
          <div className="shelf-filters">
            <label className="shelf-search">
              <SearchIcon size={15} />
              <input
                className="field__input"
                type="search"
                placeholder="Search titles and addresses…"
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
            </label>
            <div className="shelf-sort">
              {SORTS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={sort === option.value ? 'chip chip--on' : 'chip'}
                  onClick={() => setSort(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {tags.length > 0 && (
              <div className="shelf-tags" role="group" aria-label="Filter by tag">
                <button
                  type="button"
                  className={tag === null ? 'chip chip--on' : 'chip'}
                  onClick={() => setTag(null)}
                >
                  All
                </button>
                {tags.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={tag === name ? 'chip chip--on' : 'chip'}
                    onClick={() => setTag(tag === name ? null : name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            <span className="shelf-count caption">
              {visible.length === links.length
                ? `${links.length} ${links.length === 1 ? 'link' : 'links'}`
                : `${visible.length} of ${links.length}`}
            </span>
          </div>
        )}

        {error && (
          <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
            The shelf could not be read. Check the bridge and reload.
          </p>
        )}

        {ready && links.length === 0 && !error && (
          <EmptyState
            icon={<SparklesIcon size={28} />}
            title="Nothing summoned yet"
            hint="Paste a link above and it lands here — on every device at once."
          />
        )}

        {ready && links.length > 0 && visible.length === 0 && (
          <EmptyState
            icon={<SearchIcon size={28} />}
            title="Nothing matches"
            hint="No link on the shelf matches that search and tag."
          />
        )}

        {visible.length > 0 && (
          <div className="shelf-grid">
            {visible.map((link) => {
              const who = deviceName(link.authorDeviceId);
              const host = hostnameOf(link.url);
              const busy = editingId === link.id || confirmId === link.id;
              return (
                <article
                  className={busy ? 'shelf-card shelf-card--busy' : 'shelf-card'}
                  key={link.id}
                >
                  <div className="shelf-card__top">
                    <span
                      className={`shelf-card__tile ${cardToneClass(tileTone(link.url))}`}
                      aria-hidden="true"
                    >
                      {tileLetter(link.url)}
                    </span>
                    {/* The anchor stretches over the whole card (see the ::after
                        rule) so the click target is the card, not four words.
                        Controls sit above it on their own stacking layer. */}
                    <a
                      className="shelf-card__title"
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={link.url}
                    >
                      {displayTitle(link)}
                    </a>
                  </div>

                  <div className="shelf-card__meta">
                    <span className="mono shelf-card__host">{host || link.url}</span>
                    <span>{formatTimeAgo(link.createdAt)}</span>
                    {who && <span className="shelf-card__who">{who}</span>}
                  </div>

                  {link.tags.length > 0 && (
                    <div className="shelf-card__tags">
                      {link.tags.map((name) => (
                        <button
                          key={name}
                          type="button"
                          className="chip chip--tag"
                          onClick={() => setTag(name)}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}

                  {editingId === link.id && (
                    <EditRow link={link} known={tags} onDone={() => setEditingId(null)} />
                  )}

                  {confirmId === link.id && (
                    <div className="shelf-confirm" role="alert">
                      <span className="caption">Release this link?</span>
                      <Button size="sm" variant="danger" onClick={() => void remove(link)}>
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                        Keep
                      </Button>
                    </div>
                  )}

                  <div className="shelf-card__actions">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={copiedId === link.id ? 'Copied' : `Copy ${link.url}`}
                      onClick={() => void copy(link)}
                    >
                      {copiedId === link.id ? <CheckIcon size={15} /> : <ClipboardIcon size={15} />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${displayTitle(link)}`}
                      onClick={() => {
                        setConfirmId(null);
                        setEditingId((id) => (id === link.id ? null : link.id));
                      }}
                    >
                      <PencilIcon size={15} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${displayTitle(link)}`}
                      onClick={() => {
                        setEditingId(null);
                        setConfirmId((id) => (id === link.id ? null : link.id));
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
