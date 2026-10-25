# Docker on the Mac: the web host only

On the Mac, the **API always runs natively** under [PM2](pm2.md) or
[launchd](launchd.md). Files you drop into `storage/downloads` in Finder need
native file watching, and inside Docker Desktop's VM the watcher falls back to
slow polling (decision log, 2026-07-12).

The **web host may run in Docker** (PLAN-39), beside the native API. Nothing
else changes: same address, same `storage/`, same CLI. Running the web host
natively, which is the default, remains the recommended setup. Read the two
open questions below before choosing Docker.

## How it fits together

| On the Mac (native) | In Docker Desktop |
|---|---|
| the API on `127.0.0.1:4647` | the web host, publishing `4646` |
| `bifrost-mdns`, answering for `bifrost.local` | the Grafana stack, if you add `--obs` |

- **Why the advertiser is native:** publishing a port does not carry mDNS.
  `bifrost.local` is answered by multicast to 224.0.0.251:5353, Docker forwards
  only ordinary traffic to a published port, and a responder inside Docker
  Desktop's VM would announce the VM's private address. So a small native
  process, `bifrost-mdns`, answers for the name with the Mac's own addresses.
  It is the same responder the web host uses, and it re-advertises when Wi-Fi
  comes back.
- **How the web host reaches the API:** in the container,
  `compose/web.bridge.yml` sets `API_HOST=host.docker.internal`, which Docker
  Desktop points at the Mac.

## Set it up

One command, no `.env` changes (the flags decide the run's shape; `.env` keeps
the PIN, paths, limits and ports):

```bash
./bifrost start --web docker --obs        # in the foreground; Ctrl-C stops all of it
./bifrost service pm2 --web docker --obs  # always on (or: service launchd …)
```

That starts, in order:

1. the Grafana stack in Docker (`--obs`; leave it out for none),
2. the web host in Docker: `compose/web.yml` + `compose/web.bridge.yml`,
   which set its run shape in `environment:` (bridge network, `API_HOST=host.docker.internal`,
   `MDNS_ADVERTISER=host` so it stays quiet),
3. natively, the API (as `full`, so it prints the address and the join QR,
   and finds the container answering on `4646`) and `bifrost-mdns`, with
   traces on.

The `service` form starts the native processes first and keeps all of it
running across reboots. Without `./bifrost`, the same by hand:

```bash
sh scripts/start-pm2.sh --web docker --otel     # or start-launchd.sh: bifrost-api + bifrost-mdns
docker compose -f compose/web.yml -f compose/web.bridge.yml --env-file .env up -d --build
sh scripts/observability.sh                     # the Grafana stack, if you want it
```

To go back to the native web host, re-run the launcher without `--web docker`
(it removes `bifrost-mdns`) and stop the container:
`./bifrost docker down web-mac`.

## Two questions only a Mac can answer (the PLAN-39 spike)

Docker Desktop cannot run in the cloud container this was built in, so these
are checked by hand on the Mac, and this page records the answers.

1. **Does the container reach the native API?** The API listens on the Mac's
   loopback only. Docker Desktop forwards `host.docker.internal` to the Mac,
   and the question is whether the request arrives as loopback.
   - If it does, nothing changes, and the API's `trustProxy` (loopback only)
     trusts the web host's `X-Forwarded-For`.
   - If it arrives from another address, the API cannot be reached with
     `API_HOST=127.0.0.1`. This setup then needs a follow-up: the API listening
     on Docker's address, and that address trusted.
   - *Check:* with the container up, `curl http://bifrost.local:4646/api/v1/health`
     from another device answers 200, and the API's log shows the request.
2. **Does the web host see each device's own address?** Docker Desktop's port
   forwarding has historically replaced the client's address with its own
   gateway's.
   - If it does here, every device behind the containerised web host looks
     like one client: the login throttle, the rate limits, presence and upload
     attribution all see one address. One device's wrong PINs could then lock
     out everyone.
   - Nothing can recover an address the forwarder threw away. If that is what
     happens, prefer the native web host.
   - *Check:* open the page from two devices, then `grep '"incoming request"'
     storage/logs/current.log | tail`. Each line's `req.remoteAddress` should
     be that device's own address, not one shared gateway address.

Then check `dns-sd -B _http._tcp`, which should list exactly one `bifrost`.

## Results

_Not run yet: the owner's Mac spike._
