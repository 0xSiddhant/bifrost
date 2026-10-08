import { runAdvertiser } from './advertiser.js';

// `bifrost-mdns` (PLAN-39): answers for bifrost.local on this machine while the
// web host runs in a container (MDNS_ADVERTISER=host). Same shape as bootstrap.ts.
runAdvertiser('host');
