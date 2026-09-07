bifrost(1) -- talk to a Bifrost LAN hub from the terminal
=========================================================

## SYNOPSIS

`bifrost` [`--host` <address>] [`--json`] <command> [<args>...]

## DESCRIPTION

**bifrost** is a command-line client for a Bifrost server already running on your local network. It pushes and pulls files, reads and writes the shared clipboard, fetches saved documents, resolves go-links, reports server and device state, and runs a LAN speed test — all over the same HTTP API the browser app uses. It adds no server-side surface of its own.

The CLI talks to `http://bifrost.local:4646` unless you say otherwise. That name resolves through your operating system's own mDNS support, the same way a browser reaches it — dependable on macOS, and dependent on `nss-mdns` on Linux or Bonjour on Windows. When it does not resolve, every command says so and names the fix.

## GLOBAL OPTIONS

  * `--host` <address>:
    The bridge to talk to, as `bifrost.local`, `192.168.1.20`, `10.0.0.5:8080` or a full `http://…` URL. A bare host gets `http://` and port 4646. Overrides the saved default for this invocation only.

  * `--json`:
    Emit machine-readable JSON on stdout and nothing else. Progress chatter goes to stderr, a failure goes to stderr as a JSON object with an `error` key, and no command launches a browser in this mode.

  * `-v`, `--version`:
    Print the installed CLI version.

  * `-h`, `--help`:
    Print help for the program or for a command.

## COMMANDS

  * `bifrost push` <file>...:
    Send files to the bridge. They land in Send (the staging area), where any device can preview, rename, delete or publish them. Every file in one invocation travels in one request, and the per-file accepted/rejected result is printed as such — a batch with one oversize file still lands the rest. Uploads stream off disk, so a multi-gigabyte push does not grow the process.

  * `bifrost pull` [<name>] [`--out` <path>]:
    With no argument, list what Downloads is offering — root files, folders and the files inside them. With a name, download it. A bare name is enough unless two folders hold the same one, in which case pass `Folder/name`. The file lands under its own name in the current directory unless `--out` says otherwise, is written to `<name>.part` until the last byte arrives, and an existing local file is never overwritten.

  * `bifrost clip` [<text>] [`--list`] [`--rm` <id>] [`--code`] [`--lang` <lang>] [`--ttl` <seconds>]:
    Hermes, the clipboard every device shares. With text, share it. With nothing, print the most recent entry — so piping `bifrost clip` into `pbcopy` is the read half of the round trip. `--list` shows every entry, `--rm` deletes one.

  * `bifrost open` <slug> [`--type` <kind>] [`--out` <file>]:
    Print a saved document by its slug. A slug names a document but not which kind, so all four raw endpoints (runestone, edda, groot, atlas) are asked at once; `--type` skips that. A slug that exists as two kinds is reported rather than guessed at.

  * `bifrost preview` <slug> [`--type` <kind>] [`--no-open`]:
    Open a saved document's page in your browser. Edda documents have a real rendered page (`/edda/preview/<slug>`); the other three kinds have none yet, so their raw content URL is opened instead — which a browser renders readably — and the CLI says which of the two it did. `--no-open` prints the resolved URL instead of launching anything, and `--json` never launches a browser.

  * `bifrost portkey list` [`-q` <text>]:
    List LAN go-links.

  * `bifrost portkey create` <slug> <url> [`--note` <text>]:
    Create a go-link, reachable at `<host>/go/<slug>` from any device.

  * `bifrost portkey update` <slug> [`--url` <url>] [`--note` <text>]:
    Change a go-link's target or note. The slug itself is immutable.

  * `bifrost portkey rm` <slug>:
    Delete a go-link.

  * `bifrost go` <slug> [`--open`]:
    Print where a go-link points, following the real redirect. `--open` launches it as well. An unknown slug is reported as not found rather than followed into the management page.

  * `bifrost status`:
    The bridge's own report: deploy profile, uptime, and the modules it loaded.

  * `bifrost devices`:
    Which devices the bridge has seen, and which are online. Read-only.

  * `bifrost speed` [`--mb` <size>]:
    Run a LAN speed test and save it to the same history a browser-run test joins. Latency is the median of the server's configured number of round trips; the download clock starts at the first byte; the upload figure is the server's own timing. If another device is mid-test the bridge says so and this command reports it plainly.

  * `bifrost config show`:
    Print the config file's path and what it holds.

  * `bifrost config set-host` <address>:
    Save a default bridge address, so bare invocations find it.

  * `bifrost update`:
    Install the latest published CLI tarball from GitHub Releases. No-ops when the installed version already matches. This is the only command that changes the CLI's own install.

  * `bifrost doctor`:
    Walk the chain every other command runs through — config, host resolution, server reachability, server profile, CLI version, Node runtime — one line each, with the same remediation wording the failing command itself prints. The version line is informational and never affects the exit code.

## EXIT STATUS

  * 0:
    Success.

  * 1:
    A failure the CLI could name, including a partly-rejected push.

  * 3:
    The bridge could not be reached — the host did not resolve, or nothing answered on it.

  * 4:
    The bridge answered, and there is no such file, document or link.

  * 5:
    The bridge refused because something else holds the thing — a taken go-link slug, a speed test already in flight, an ambiguous cross-kind slug.

## FILES

  * `~/.config/bifrost/config.json`:
    The saved host, this machine's device id (minted on first run, sent as `x-bifrost-device` so clips and links are attributed), and the throttled cache of the last GitHub release check. `$XDG_CONFIG_HOME` is honoured where set; on Windows the file lives under `%APPDATA%\bifrost`.

## NETWORK

Only `bifrost update` and `bifrost doctor` ever reach the internet, and only to read `https://api.github.com/repos/0xSiddhant/bifrost/releases/latest`, throttled to one request every six hours across both. Every other command talks solely to the bridge on your LAN.

## EXAMPLES

Send two files and see what landed:

    bifrost push ~/Desktop/notes.pdf ~/Desktop/photo.jpg

List Downloads, then fetch one file:

    bifrost pull
    bifrost pull notes.pdf --out /tmp/notes.pdf

Move text between machines:

    bifrost clip "ssh pi@10.0.0.7"
    bifrost clip | pbcopy

Read a saved document and pipe it onward:

    bifrost open my-config-a1b2c3 --type runestone | jq .

Point the CLI at a bridge whose `.local` name does not resolve:

    bifrost config set-host 192.168.1.20
    bifrost doctor

## SEE ALSO

The project README, and `.agent/context/architecture.md` in the Bifrost repository, for what the server side of each of these endpoints does.
