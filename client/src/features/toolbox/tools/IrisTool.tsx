import { useRef, useState, type DragEvent } from 'react';
import { Button } from '../../../core/ui/Button';
import { Input } from '../../../core/ui/Field';
import { copyText } from '../../../core/copy';
import { notify } from '../../../core/notify';
import { log } from '../../../core/log';
import {
  contrastRatio,
  extractPalette,
  paletteToThemeJson,
  parseColour,
  toHex,
  toHslString,
  toOklchString,
  toRgbString,
  wcagVerdict,
} from '../lib/colour';
import { useToolState } from '../useToolState';

/** Longest edge the dropped image is sampled at — 128px is ~16k pixels, plenty
 *  for "what colours are in this?" and instant on a phone. */
const SAMPLE_EDGE = 128;

/**
 * Iris (PLAN-18): colour conversion, a WCAG contrast checker, and palette
 * extraction from a dropped image — with the palette exportable as a
 * `themes/*.json` starter, since a photo is where most house themes begin.
 */
export function IrisTool() {
  const [colour, setColour] = useToolState('iris.colour', '#5eead4');
  const [foreground, setForeground] = useToolState('iris.fg', '#0a0a12');
  const [background, setBackground] = useToolState('iris.bg', '#5eead4');
  const [palette, setPalette] = useToolState<string[]>('iris.palette', []);
  const [themeName, setThemeName] = useToolState('iris.themeName', 'My Theme');
  const [dragging, setDragging] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = parseColour(colour);
  const ratio = contrastRatio(foreground, background);
  const verdict = ratio === null ? null : wcagVerdict(ratio);

  const copy = async (value: string) => {
    if (!value) return;
    if (await copyText(value)) notify.ok('Copied');
    else notify.error('Could not reach the clipboard — select the value and copy it by hand.');
  };

  /** Draw the image small and read its pixels back — all in this browser. */
  const readImage = (file: File) => {
    setImageError(null);
    if (!file.type.startsWith('image/')) {
      setImageError('That is not an image.');
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const scale = SAMPLE_EDGE / Math.max(image.width, image.height, 1);
        const width = Math.max(1, Math.round(image.width * Math.min(1, scale)));
        const height = Math.max(1, Math.round(image.height * Math.min(1, scale)));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          setImageError('This browser would not give up a canvas to read the image with.');
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        setPalette(extractPalette(context.getImageData(0, 0, width, height).data, 8));
      } catch (error) {
        // Worth a line: a same-origin blob should never taint the canvas, so a
        // SecurityError here means an assumption about the drop path is wrong.
        log.warn(`iris: could not read pixels from the dropped image — ${String(error)}`, {
          module: 'toolbox',
          stack: error instanceof Error ? error.stack : undefined,
        });
        setImageError('Could not read that image.');
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setImageError('That file could not be decoded as an image.');
    };
    image.src = url;
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) readImage(file);
  };

  const themeId =
    themeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'my-theme';

  const downloadTheme = (mode: 'dark' | 'light') => {
    const json = paletteToThemeJson(palette, { id: themeId, name: themeName || 'My Theme', mode });
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${themeId}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <>
      <div className="tool-controls">
        <div className="field">
          <label className="field__label" htmlFor="iris-colour">
            Colour
          </label>
          <div className="tool-colour-row">
            <input
              id="iris-colour"
              className="field__input mono"
              spellCheck={false}
              placeholder="#5eead4, rgb(94 234 212), hsl(168 76% 64%)"
              value={colour}
              onChange={(event) => setColour(event.target.value)}
            />
            <input
              type="color"
              className="tool-swatch-input"
              aria-label="Pick a colour"
              value={parsed ? toHex({ ...parsed, a: 1 }) : '#000000'}
              onChange={(event) => setColour(event.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <span className="field__label">Contrast check</span>
          <div className="tool-contrast">
            <Input
              label="Foreground"
              spellCheck={false}
              className="field__input mono"
              value={foreground}
              onChange={(event) => setForeground(event.target.value)}
            />
            <Input
              label="Background"
              spellCheck={false}
              className="field__input mono"
              value={background}
              onChange={(event) => setBackground(event.target.value)}
            />
          </div>
          {verdict ? (
            <>
              <div
                className="tool-contrast__preview"
                style={{ color: foreground, background }}
                aria-hidden="true"
              >
                The quick brown fox
              </div>
              <p className="caption">
                <strong>{verdict.ratio.toFixed(2)}:1</strong> —{' '}
                {[
                  `AA ${verdict.aaNormal ? 'pass' : 'fail'}`,
                  `AA large ${verdict.aaLarge ? 'pass' : 'fail'}`,
                  `AAA ${verdict.aaaNormal ? 'pass' : 'fail'}`,
                ].join(' · ')}
              </p>
            </>
          ) : (
            <p className="caption">Enter two colours to see their WCAG ratio.</p>
          )}
        </div>

        <div
          className={dragging ? 'dropzone dropzone--active' : 'dropzone'}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') fileRef.current?.click();
          }}
        >
          <span>Drop an image to pull its palette</span>
          <span className="caption">Read in this browser — nothing is uploaded.</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) readImage(file);
            }}
          />
        </div>
        {imageError && (
          <p className="tool-error" role="status">
            {imageError}
          </p>
        )}
      </div>

      <div className="tool-output">
        {parsed ? (
          <dl className="tool-rows">
            {(
              [
                ['Hex', toHex(parsed)],
                ['RGB', toRgbString(parsed)],
                ['HSL', toHslString(parsed)],
                ['OKLCH', toOklchString(parsed)],
              ] as Array<[string, string]>
            ).map(([label, value]) => (
              <div className="tool-rows__row" key={label}>
                <dt>{label}</dt>
                <dd className="mono">{value}</dd>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => copy(value)}
                  aria-label={`Copy ${label}`}
                >
                  Copy
                </button>
              </div>
            ))}
          </dl>
        ) : (
          <p className="tool-error" role="status">
            That is not a colour this tool can read — try #5eead4, rgb(…) or hsl(…).
          </p>
        )}

        {palette.length > 0 && (
          <>
            <span className="field__label">Extracted palette</span>
            <ul className="tool-palette">
              {palette.map((swatch, index) => (
                <li key={`${swatch}-${index}`}>
                  <button
                    type="button"
                    className="tool-palette__chip"
                    style={{ background: swatch }}
                    onClick={() => setColour(swatch)}
                    aria-label={`Use ${swatch}`}
                  />
                  <span className="caption mono">{swatch}</span>
                </li>
              ))}
            </ul>

            <div className="field">
              <label className="field__label" htmlFor="iris-theme-name">
                Export as a theme starter
              </label>
              <div className="tool-colour-row">
                <input
                  id="iris-theme-name"
                  className="field__input"
                  value={themeName}
                  onChange={(event) => setThemeName(event.target.value)}
                />
              </div>
              <div className="tool-chiprow">
                <Button size="sm" onClick={() => downloadTheme('dark')}>
                  Download dark
                </Button>
                <Button variant="ghost" size="sm" onClick={() => downloadTheme('light')}>
                  Download light
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    copy(
                      paletteToThemeJson(palette, {
                        id: themeId,
                        name: themeName || 'My Theme',
                        mode: 'dark',
                      }),
                    )
                  }
                >
                  Copy JSON
                </Button>
              </div>
              <p className="caption">
                Saves <span className="mono">{themeId}.json</span> — the 14 required roles plus ten
                card hues. Drop it in <span className="mono">themes/</span> and it appears in the
                switcher within a couple of seconds. Everything else is derived, so edit from here.
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
