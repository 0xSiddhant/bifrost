/**
 * Beautify (Prettier) and minify (Terser) for Loki (PLAN-12). Both libraries
 * are heavy (~300 KB / ~200 KB) and only needed on demand, so they are
 * dynamically imported — the main bundle never pays for them. Pure in-browser
 * compute; nothing leaves the device.
 */

export interface BeautifyOptions {
  /** Spaces per indent level. */
  tabWidth: number;
  singleQuote: boolean;
  semi: boolean;
}

export interface MinifyOptions {
  /** Shorten local identifiers. */
  mangle: boolean;
}

export interface MinifyResult {
  code: string;
  beforeBytes: number;
  afterBytes: number;
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

export async function beautifyJs(code: string, options: BeautifyOptions): Promise<string> {
  const [{ format }, babel, estree] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel').then((m) => m.default ?? m),
    import('prettier/plugins/estree').then((m) => m.default ?? m),
  ]);
  return format(code, {
    parser: 'babel',
    plugins: [babel, estree],
    tabWidth: options.tabWidth,
    singleQuote: options.singleQuote,
    semi: options.semi,
  });
}

export async function minifyJs(code: string, options: MinifyOptions): Promise<MinifyResult> {
  const { minify } = await import('terser');
  const result = await minify(code, {
    mangle: options.mangle,
    // negate_iife rewrites `(function(){})()` as `!function(){}()` — a valid
    // but surprising leading `!`. Off, so minify output reads as expected.
    compress: { negate_iife: false },
  });
  const out = result.code ?? '';
  return { code: out, beforeBytes: byteLength(code), afterBytes: byteLength(out) };
}
