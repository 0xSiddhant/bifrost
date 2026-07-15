import { useEffect, useRef, useState } from 'react';
import { themeEngine, type ThemeEngineState } from '../theme';
import { Button } from './Button';
import { CheckIcon, MoonIcon, SunIcon } from './icons';

/**
 * Shell theme picker fed by the PLAN-04 engine: every validated theme in
 * themes/, live-updated via SSE, with mode icon and color-dot preview.
 */
export function ThemeSwitcher() {
  const [state, setState] = useState<ThemeEngineState>(() => themeEngine.getState());
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => themeEngine.subscribe(setState), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = state.themes.find((theme) => theme.id === state.activeId);

  return (
    <div className="theme-switcher" ref={containerRef}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Theme: ${active?.name ?? 'default'} — open theme picker`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {active?.mode === 'light' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
      </Button>

      {open && (
        <div className="theme-menu" role="menu" aria-label="Themes">
          {state.themes.length === 0 && <span className="caption">No themes loaded</span>}
          {state.themes.map((theme) => (
            <button
              key={theme.id}
              type="button"
              role="menuitemradio"
              aria-checked={theme.id === state.activeId}
              className={
                theme.id === state.activeId ? 'theme-menu__item is-active' : 'theme-menu__item'
              }
              onClick={() => {
                void themeEngine.setTheme(theme.id);
                setOpen(false);
              }}
            >
              <span
                className="theme-menu__dot"
                style={{ background: theme.preview.bg, borderColor: theme.preview.accent }}
                aria-hidden="true"
              >
                <span style={{ background: theme.preview.accent }} />
              </span>
              <span className="theme-menu__name">{theme.name}</span>
              <span className="caption">{theme.mode}</span>
              {theme.id === state.activeId && <CheckIcon size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
