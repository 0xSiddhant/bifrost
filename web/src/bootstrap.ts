import { main } from './main.js';

// The web host's entry, called unconditionally: process managers (PM2's fork
// mode, launchd, compose) wrap or import the script, so a "am I the direct
// entry" guard would never fire under them. Same pattern as the server's.
void main();
