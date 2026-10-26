#!/bin/zsh
cd "${0:A:h}" || exit 1
if [[ ! -d node_modules ]]; then npm ci || exit 1; fi
if [[ ! -f dist/index.html ]]; then npm run build || exit 1; fi
if [[ "$(/usr/bin/curl --silent --fail --max-time 1 http://127.0.0.1:9595/__desk95_health)" == '{"app":"Desk95"}' ]]; then
  open 'http://127.0.0.1:9595'
  exit 0
fi
node server.mjs &
desk95_pid=$!
trap 'kill "$desk95_pid" 2>/dev/null' EXIT
trap 'exit 0' INT TERM
for desk95_attempt in {1..50}; do
  if [[ "$(/usr/bin/curl --silent --fail --max-time 1 http://127.0.0.1:9595/__desk95_health)" == '{"app":"Desk95"}' ]]; then
    open 'http://127.0.0.1:9595'
    wait "$desk95_pid"
    exit $?
  fi
  if ! kill -0 "$desk95_pid" 2>/dev/null; then
    wait "$desk95_pid"
    exit $?
  fi
  sleep 0.1
done
print 'Desk95 could not start. Check whether port 9595 is occupied.'
exit 1
