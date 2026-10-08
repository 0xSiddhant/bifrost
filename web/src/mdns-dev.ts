import { runAdvertiser } from './advertiser.js';

// `npm run dev` has no web host (Vite serves the client on PORT), so this keeps
// `bifrost.local` working in development, as the API server's responder did
// before PLAN-36. It answers for the name and nothing else.
runAdvertiser('dev');
