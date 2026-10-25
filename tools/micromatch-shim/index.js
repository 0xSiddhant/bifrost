'use strict';

/*
 * Bifrost's stand-in for micromatch 4.0.8, installed in its place by the root
 * package.json `overrides` (see README.md). Its only consumer is
 * eslint-plugin-boundaries, which calls exactly isMatch, capture and makeRe.
 * In micromatch 4.0.8 those three are thin passthroughs to picomatch and never
 * reach the `braces` package (only micromatch.braces/braceExpand do); they are
 * copied here verbatim, against the same picomatch ^2.3.1, so matching is
 * identical and the vulnerable `braces` (GHSA-vfj7-8cjw-p6xm, no patched
 * release) is not installed at all.
 *
 * Anything else throws by name, so a future plugin version that needs more of
 * micromatch fails lint loudly instead of matching differently.
 *
 * Copyright (c) 2014-present, Jon Schlinkert (micromatch, MIT). See LICENSE.
 */

const picomatch = require('picomatch');
const utils = require('picomatch/lib/utils');

const micromatch = {};

micromatch.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);

micromatch.capture = (glob, input, options) => {
  let posix = utils.isWindows(options);
  let regex = picomatch.makeRe(String(glob), { ...options, capture: true });
  let match = regex.exec(posix ? utils.toPosixSlashes(input) : input);

  if (match) {
    return match.slice(1).map(v => (v === void 0 ? '' : v));
  }
};

micromatch.makeRe = (...args) => picomatch.makeRe(...args);

const PROVIDED = new Set(Object.keys(micromatch));

module.exports = new Proxy(micromatch, {
  get(target, prop, receiver) {
    // Module interop and inspection probe these; they are not API calls.
    if (typeof prop === 'symbol' || prop === '__esModule' || prop === 'default' || prop === 'then') {
      return prop === 'default' ? receiver : Reflect.get(target, prop, receiver);
    }
    if (!PROVIDED.has(prop)) {
      throw new Error(
        `micromatch.${prop} is not provided by Bifrost's micromatch shim (tools/micromatch-shim); ` +
          'add it there, copied from micromatch 4.0.8, or remove the override',
      );
    }
    return target[prop];
  },
});
