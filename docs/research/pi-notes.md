# PI Notes

## Scope Reviewed

- `references/pi-mono/packages/ai/README.md`
- `references/pi-mono/packages/ai/package.json`
- `references/pi-mono/packages/agent/README.md`
- `references/pi-mono/packages/agent/package.json`
- `references/pi-mono/packages/coding-agent/README.md`
- `references/pi-mono/packages/web-ui/README.md`
- `references/pi-mono/packages/web-ui/example/README.md`
- `references/pi-mono/packages/tui/README.md` (optional package when present)

## Runtime-Relevant Takeaways

- `packages/ai` provides model/provider/tooling integration surfaces and should anchor provider abstraction in SPORE runtime adapters.
- `packages/agent` provides stateful agent runtime and event-friendly agent lifecycle patterns relevant to SPORE session model.
- `packages/coding-agent` demonstrates how skills/extensions/prompts can be composed into practical execution behavior.
- `packages/web-ui` provides reusable primitives for conversation/session-oriented operator interfaces.

## Extensibility Surfaces to Mirror in SPORE

- model/provider config abstraction,
- tool registration boundaries,
- prompt/profile overlays,
- extension registration and runtime hooks,
- shared contracts between runtime and UI surfaces.

## SPORE Decision Impact

These findings reinforce ADR-0002: PI-first runtime integration while keeping SPORE-owned config, governance, and session contracts.
