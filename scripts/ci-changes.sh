#!/bin/sh
# Decides whether CI's build and test jobs need to run (owner, 2026-11-27).
#
# Reads the changed paths, one per line, on stdin and prints `code=false` when
# every one of them is documentation that no build, test or workflow reads,
# else `code=true`. An empty list means the list could not be had (an API
# error, a brand-new branch, a change too large to list), so everything runs.
#
# Markdown is documentation except where the code uses it: the Guide panel's
# pages are bundled from client/src/, the CLI's man page is built from
# cli/man/, and the server serves CHANGELOG.md (Heimdall's About). Anything
# else under .agents/ or .claude/ (a skill's script, say) is code: `eslint .`
# lints those folders too.

listed=false
docs_only=true
# `|| [ -n ... ]` keeps a last line that has no newline after it.
while IFS= read -r file || [ -n "$file" ]; do
  [ -z "$file" ] && continue
  listed=true
  case "$file" in
    client/src/* | cli/man/* | CHANGELOG.md) docs_only=false ;;
    docs/* | LICENSE | *.md) ;;
    *) docs_only=false ;;
  esac
done

if [ "$listed" = true ] && [ "$docs_only" = true ]; then
  echo code=false
else
  echo code=true
fi
