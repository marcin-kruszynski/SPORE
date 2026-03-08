# `services/session-gateway`

This service now provides the first HTTP gateway over SPORE session and event state.

## Current Endpoints

- `GET /health`
- `GET /status`
- `GET /sessions`
- `GET /sessions/:id`
- `GET /sessions/:id/artifacts`
- `GET /sessions/:id/artifacts/:artifact`
- `GET /events?session=...&run=...&type=...&limit=...`
- `GET /stream/events?session=...&run=...&type=...`
- `POST /sessions/:id/actions/stop`
- `POST /sessions/:id/actions/mark-complete`
- `POST /sessions/:id/actions/steer`

## Run

```bash
npm run gateway:start
```

Examples:

```bash
curl http://127.0.0.1:8787/status
curl http://127.0.0.1:8787/sessions/control-live-002/artifacts
curl http://127.0.0.1:8787/sessions/control-live-002/artifacts/transcript
curl -N http://127.0.0.1:8787/stream/events?session=control-live-002

curl -X POST http://127.0.0.1:8787/sessions/control-live-002/actions/stop \
  -H 'content-type: application/json' \
  -d '{"reason":"operator stop","force":true}'

curl -X POST http://127.0.0.1:8787/sessions/lead-session-002/actions/mark-complete \
  -H 'content-type: application/json' \
  -d '{"reason":"operator override"}'

curl -X POST http://127.0.0.1:8787/sessions/control-live-002/actions/steer \
  -H 'content-type: application/json' \
  -d '{"message":"Report status","enter":true}'
```

Environment variables:

- `SPORE_GATEWAY_HOST` default `127.0.0.1`
- `SPORE_GATEWAY_PORT` default `8787`

The write side is still intentionally narrow:

- `stop` issues an operator stop request and settles the session as `stopped`
- `mark-complete` applies an operator completion override
- `steer` appends to a control queue and routes through PI RPC for `pi-rpc` sessions; tmux text delivery remains the fallback for non-RPC launchers

This is not yet the final control plane, but it is enough for early operator workflows and future Web UI integration.
