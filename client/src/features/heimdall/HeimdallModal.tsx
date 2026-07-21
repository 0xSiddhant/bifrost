import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../core/api';
import { Button } from '../../core/ui/Button';
import { Input } from '../../core/ui/Field';
import { CloseIcon, SearchIcon, ShieldIcon } from '../../core/ui/icons';
import { login, logout } from './api';
import { ctlId, SECTION_GROUPS, SECTIONS } from './sections';
import { searchSections } from './search';

const [FIRST_SECTION] = SECTIONS;

type AuthState = 'pin' | 'open';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function LoginView({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(pin);
      onUnlock();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts — wait a few minutes.'
          : 'Incorrect PIN.',
      );
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="heimdall-login stack"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <span className="empty__icon">
        <ShieldIcon size={28} />
      </span>
      <h2>Heimdall</h2>
      <p className="caption">The gatekeeper sees all. Identify yourself.</p>
      <Input
        label="PIN"
        type="password"
        inputMode="numeric"
        placeholder="••••"
        value={pin}
        autoFocus
        onChange={(event) => setPin(event.target.value)}
      />
      {error && (
        <p className="caption" role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || pin.length === 0}>
        {busy ? 'Opening…' : 'Enter'}
      </Button>
    </form>
  );
}

/**
 * Heimdall as a settings-style modal overlay (PLAN-10). Mounts at the app-shell
 * level over whatever page is open; closing unmounts with no navigation.
 *
 * Auth (owner override of the plan's relaxed model, 2026-07-21): the PIN is
 * required on every open. The modal remounts each time it opens, so it always
 * starts on the PIN view; any close (scrim, Esc, Lock) ends the session, and a
 * page refresh naturally re-locks it — no ambient admin access survives a close
 * or a reload.
 */
export function HeimdallModal({ onClose }: { onClose: () => void }) {
  const [auth, setAuth] = useState<AuthState>('pin');
  const [activeId, setActiveId] = useState<string>(FIRST_SECTION?.id ?? '');
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false); // iPad-portrait collapsible panel
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () => SECTIONS.find((section) => section.id === activeId) ?? FIRST_SECTION,
    [activeId],
  );
  const hits = useMemo(() => searchSections(query), [query]);

  // Any close ends the admin session, so reopening (or a refresh) requires the
  // PIN again — no ambient admin access lingers.
  const close = useCallback(() => {
    void logout().catch(() => {});
    onClose();
  }, [onClose]);

  // Esc closes; Tab is trapped inside the dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const nodes = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [close]);

  // Initial focus lands inside the dialog (the PIN field first, then search).
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [auth]);

  // Search jump: scroll the target control into view and pulse-highlight it.
  // The control may render after an async fetch, so retry a few frames.
  useEffect(() => {
    if (!highlight) return;
    let frames = 0;
    let raf = 0;
    let timer = 0;
    const tick = () => {
      const el = document.getElementById(ctlId(highlight));
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('is-highlighted');
        timer = window.setTimeout(() => {
          el.classList.remove('is-highlighted');
          setHighlight(null);
        }, 2000);
        return;
      }
      if (frames++ < 90) raf = requestAnimationFrame(tick);
      else setHighlight(null);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [highlight, activeId]);

  const goTo = (sectionId: string, controlId?: string) => {
    setActiveId(sectionId);
    setQuery('');
    setPanelOpen(false);
    contentRef.current?.scrollTo({ top: 0 });
    setHighlight(controlId ?? null);
  };

  const Section = active?.Component ?? (() => null);

  return (
    <div className="modal-scrim heimdall-scrim" onMouseDown={close}>
      <div
        className="heimdall-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Heimdall"
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {auth === 'pin' ? (
          <div className="heimdall-modal__login">
            {/* Login first in DOM order so the PIN field takes initial focus. */}
            <LoginView onUnlock={() => setAuth('open')} />
            <button className="heimdall-close" aria-label="Close" onClick={close}>
              <CloseIcon size={18} />
            </button>
          </div>
        ) : (
          <>
            <aside className={`heimdall-panel ${panelOpen ? 'is-open' : ''}`}>
              <div className="heimdall-brand">
                <ShieldIcon size={18} />
                <span>Heimdall</span>
              </div>
              <div className="heimdall-search">
                <SearchIcon size={16} />
                <input
                  type="search"
                  placeholder="Search settings…"
                  value={query}
                  aria-label="Search Heimdall"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {query.trim() ? (
                <div className="heimdall-nav" role="listbox" aria-label="Search results">
                  {hits.length === 0 ? (
                    <p className="caption heimdall-nav__empty">No matches.</p>
                  ) : (
                    hits.map((hit) => (
                      <button
                        key={`${hit.sectionId}:${hit.controlId ?? ''}`}
                        className="heimdall-nav__item"
                        onClick={() => goTo(hit.sectionId, hit.controlId)}
                      >
                        <span>{hit.label}</span>
                        {hit.controlId && <span className="badge">{hit.sectionLabel}</span>}
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <nav className="heimdall-nav" aria-label="Sections">
                  {SECTION_GROUPS.map((group) => {
                    const items = SECTIONS.filter((section) => section.group === group);
                    if (items.length === 0) return null;
                    return (
                      <div className="heimdall-nav__group" key={group}>
                        <span className="heimdall-nav__group-label">{group}</span>
                        {items.map((section) => (
                          <button
                            key={section.id}
                            className={`heimdall-nav__item ${section.id === activeId ? 'is-active' : ''}`}
                            onClick={() => goTo(section.id)}
                          >
                            {section.icon}
                            <span>{section.label}</span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </nav>
              )}
            </aside>

            <section className="heimdall-content" ref={contentRef}>
              <header className="heimdall-content__head">
                <button
                  className="heimdall-panel-toggle"
                  aria-label="Toggle sections"
                  onClick={() => setPanelOpen((open) => !open)}
                >
                  <SearchIcon size={16} />
                </button>
                <div className="heimdall-content__titles">
                  <h2>{active?.label}</h2>
                  <p className="caption">{active?.blurb}</p>
                </div>
                <div className="heimdall-content__actions">
                  {/* Every close ends the session; Lock is the explicit affordance. */}
                  <Button variant="ghost" size="sm" onClick={close}>
                    Lock
                  </Button>
                </div>
              </header>
              <div className="heimdall-content__body">
                <Section onLock={close} />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
