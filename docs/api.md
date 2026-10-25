# The API docs

Bifrost describes its own HTTP API as OpenAPI 3.1 (`server/openapi.json`, generated
from the routes), and the API server serves it as **Swagger UI** (PLAN-38):

| URL (on the server machine)       | What                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| `http://127.0.0.1:4647/docs`      | Swagger UI: every v1 operation, grouped by module, with "Try it out" |
| `http://127.0.0.1:4647/docs/json` | The live spec as JSON (the same document as `server/openapi.json`)   |
| `http://127.0.0.1:4647/docs/yaml` | The same, as YAML                                                    |

`4647` is `API_PORT`. The API server prints the address at boot (`api docs: …`).
There is nothing to configure: the docs are always on, and they have no `.env` keys.

## Why only on the server machine

The API server listens on **loopback** (`API_HOST=127.0.0.1`, PLAN-36). The address
every device opens, `bifrost.local:4646`, is the web host, and it forwards only the
API's own paths (`/api`, `/<kind>/api`, `/go`, `/metrics`) to the API. So:

- `http://bifrost.local:4646/docs` is the app's own not-found page, never the docs;
- `http://bifrost.local:4647/docs` does not answer either, **even on the Mac
  itself**: `bifrost.local` resolves to the Mac's LAN address, and the API ignores
  everything but loopback. Use `127.0.0.1` (or `localhost`).

Neither client build links to the docs or knows they exist.

### From another machine: an SSH tunnel

```bash
ssh -L 4647:127.0.0.1:4647 you@your-mac.local
# then, on this machine: http://127.0.0.1:4647/docs
```

The tunnel forwards your local port 4647 to the Mac's loopback 4647, so the browser
talks to the API as if it ran locally. Close the SSH session to close it.

## "Try it out" sends real requests

Every operation can be tried, and every request hits **this hub**: saving a document
saves it, deleting a file deletes it, and changing a setting changes it for every
device. The description at the top of the page says so too.

**Admin operations** (the padlock) need the Heimdall session cookie:

1. Open `POST /api/v1/heimdall/login`, **Try it out**, and send `{"pin": "<your PIN>"}`.
2. The answer sets the `bifrost_admin` cookie on the docs' origin, so the admin
   operations now work from the same page, exactly as they do in the app.
3. `POST /api/v1/heimdall/logout` ends the session.

## What the docs show

- **Every operation under v1** (`/api/v1/…`, and each raw document at
  `/<kind>/api/v1/{slug}`). The paths from before versioning still answer, as v1,
  with a `Deprecation` header; they are described once, in the page's introduction.
- **One path per document kind for its record**: `/api/v1/<kind>/{key}`. A read
  takes the slug and a write or delete takes the id; each operation says which, and
  keeps its own limits. The real routes are unchanged: only the spec merges the two
  (OpenAPI forbids two paths that differ only in a parameter's name).
- **Examples** where a shape is not obvious: the error envelope, one page of each
  paged listing, and each raw document.
- **Deep links**: `http://127.0.0.1:4647/docs#/runestone/listRunestones` opens that
  operation.

## Offline and locked down

The page loads only its own bundled files. Swagger UI's online validator badge is
off, and the page's Content-Security-Policy allows nothing outside its own origin.
That covers scripts, styles, fonts, images and requests, so a future Swagger UI
version that tried to reach the internet would be blocked as well.

## Keeping the spec honest

- `npm run api:spec` regenerates `server/openapi.json` after a route changes, and
  `npm test` fails while it is stale.
- The spec passes Redocly's `recommended` lint (`server/src/openapi.test.ts`). The
  few rules it cannot meet are listed there with their reasons.
- `server/src/openapi-compat.test.ts` fails a change that removes an operation, a
  status or a response field from v1 (PLAN-37).
