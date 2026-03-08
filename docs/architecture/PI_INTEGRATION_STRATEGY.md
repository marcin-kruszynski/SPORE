# PI Integration Strategy

## Target Packages

- `pi-mono/packages/ai`
- `pi-mono/packages/agent`
- `pi-mono/packages/coding-agent`
- `pi-mono/packages/web-ui`
- optional: `pi-mono/packages/tui`

## Integration Objectives

- provider/model/tool abstraction from PI AI layer,
- stateful agent runtime and event streaming from PI agent layer,
- coding-agent skills/extensions/prompt packaging patterns,
- web-ui primitives for future operator console,
- optional TUI components for local operations console.

## Extensibility Surfaces

- tool registration and provider config,
- profile overlays and prompt templates,
- extension modules,
- RPC/SDK integration routes.

## Guardrail

PI is the implementation foundation, but SPORE keeps project-level models and governance explicit and repository-owned.
