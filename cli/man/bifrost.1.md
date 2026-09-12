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

  * `bifrost push` <path>... [`-d`|`--dir` <name>]:
    Send files to the bridge, named individually, as folders, or as `.` for everything in the current directory. A folder argument expands to the files **directly** inside it — not recursively, because Downloads is one level deep and Send is flat, so a nested tree has nowhere to land; sub-folders and hidden files are skipped and counted. By default they land in Send (the staging area), where any device can preview, rename, delete or publish them. `--dir` writes straight into `Downloads/<name>` instead, creating the folder if missing and appending to it if not: the files are live to every device immediately, with no staging step and no undo. Batches are split to fit the server's own per-request file cap, and the per-file accepted/rejected result is printed as such — a batch with one oversize file still lands the rest. Uploads stream off disk, so a multi-gigabyte push does not grow the process.

  * `bifrost pull` [<name>...] [`-l`|`--list`] [`--out` <path>]:
    With no argument or `--list`, list what Downloads is offering — root files, folders and the files inside them, grouped so a folder is followed by its contents. A folder has no size of its own, so that cell reads `—` rather than a misleading zero. With names, download them: several at once, space-separated, files and folders mixed. A folder arrives as `<name>.zip`, streamed and built on the fly. A bare name is enough unless two folders hold the same one, in which case pass `Folder/name`. Each lands under its own name in the current directory unless `--out` says otherwise (which is refused with more than one name, since it names one destination), is written to `<name>.part` until the last byte arrives, and an existing local file is never overwritten.

  * `bifrost clip` [<text>] [`--list`] [`--rm` <id>] [`--code`] [`--lang` <lang>] [`--ttl` <seconds>]:
    Hermes, the clipboard every device shares. With text, share it. With nothing, print the most recent entry — so piping `bifrost clip` into `pbcopy` is the read half of the round trip. `--list` shows every entry, `--rm` deletes one.

  * `bifrost open` <slug> [`--type` <kind>] [`--out` <file>]:
    Print a saved document by its slug. A slug names a document but not which kind, so all four raw endpoints (runestone, edda, groot, atlas) are asked at once; `--type` skips that. A slug that exists as two kinds is reported rather than guessed at.

  * `bifrost preview` <target> [`--type` <kind|destination>] [`--no-open`]:
    Open a saved document's page, or a local file, in your browser. A <target> carrying a path separator, a leading `.`, or an extension is read as a **file on this machine**; anything else is a document **slug**. Edda documents have a real rendered page (`/edda/preview/<slug>`); the other three kinds have none yet, so their raw content URL is opened instead — which a browser renders readably — and the CLI says which of the two it did. A local file is served to the page over a one-shot loopback HTTP server on an OS-assigned port, scoped by CORS to your Bifrost origin alone and closed as soon as the page has read it, or after 60 seconds if it never does. `--type` is the document kind for a slug and the destination for a file; `saga` presents `.md`, `.markdown` and `.pdf` as slides — a PDF one page per slide. It is required for markdown, which has no default destination yet, and not for a PDF, which has only the one. An extension or destination the routing table has no row for is refused before any port is opened or any browser launched. `--no-open` prints the resolved URL instead of launching anything, and `--json` never launches a browser — in neither mode is the file served, since nothing will fetch it.

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

## OUTPUT

Every command prints through one formatter: a titled section, aligned box-drawn tables, `✓`/`✗`/`⚠` marks, and a progress bar for transfers. Colour in a table is semantic and consistent: cyan is the thing you would type next (a slug, a folder), dim is metadata (ids, timestamps, sizes), green is a live state, magenta and yellow mark media and archive files in a **pull** listing, and content itself is left in the terminal's own colour. All of it is decided by whether the output is a terminal — colour and progress appear on a TTY and disappear the instant output is piped or redirected, so nothing downstream ever sees an escape sequence or a redrawn line. `NO_COLOR` (any value) disables colour, `FORCE_COLOR` enables it, and `--json` disables both. Progress is drawn on stderr, never stdout.

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

Send everything in this folder, straight into a named Downloads folder:

    bifrost push . --dir Holiday

List Downloads, then fetch a file and a whole folder at once:

    bifrost pull --list
    bifrost pull notes.pdf Holiday

Move text between machines:

    bifrost clip "ssh pi@10.0.0.7"
    bifrost clip | pbcopy

Read a saved document and pipe it onward:

    bifrost open my-config-a1b2c3 --type runestone | jq .

Point the CLI at a bridge whose `.local` name does not resolve:

    bifrost config set-host 192.168.1.20
    bifrost doctor

## SEE ALSO

The project README, and `.agents/context/architecture.md` in the Bifrost repository, for what the server side of each of these endpoints does.
