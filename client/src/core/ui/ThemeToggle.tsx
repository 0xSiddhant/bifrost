import { useState } from 'react';
import { applyTheme, getTheme } from '../theme';
import { Button } from './Button';
import { MoonIcon, SunIcon } from './icons';

/** Swaps one attribute on <html>; PLAN-04's engine replaces the theme list. */
export function ThemeToggle() {
  const [theme, setTheme] = useState(getTheme);
  const next = theme === 'aurora' ? 'daybreak' : 'aurora';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
    >
      {theme === 'aurora' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
    </Button>
  );
}
