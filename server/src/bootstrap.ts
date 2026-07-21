/**
 * Production entry point for process managers.
 *
 * `app.ts` only self-starts when it is the *direct* entry (`node dist/app.js`).
 * PM2's fork mode runs your script inside its own wrapper process, so `app.ts`
 * is imported rather than direct — its guard would then never call main() and
 * the process would exit immediately. This entry calls main() unconditionally,
 * so it works under PM2, launchd, Docker, and `npm start` alike.
 */
import { main } from './app.js';

void main();
