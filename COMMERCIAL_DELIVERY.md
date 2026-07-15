# Commercial Delivery

This repository can be delivered as a single installable package instead of the
full source tree.

## Customer package

- File: `agent-continuity-runtime-1.0.0.tgz`
- Install command: `npm install -g ./agent-continuity-runtime-1.0.0.tgz`

## What changed in this build

This build includes structured cross-tool memory:

- Resume briefs now carry user intent and key handoff context
- Runtime handoff automatically enriches continuity memory before failover or
  switch checkpoints
- `prepare_handoff` also auto-records handoff memory

## What to send a customer

Send these items:

1. `agent-continuity-runtime-1.0.0.tgz`
2. This install guide
3. Any pricing, support, and license terms you want the customer to accept

Do not send the full development repository unless you intend to distribute the
source code itself.

## Customer prerequisites

- Node.js 22 or newer
- npm 11 or newer
- Optional:
  - `claude` installed and authenticated
  - `codex` installed and authenticated

## Customer install steps

```bash
npm install -g ./agent-continuity-runtime-1.0.0.tgz
acr --help
acr setup
acr start .
```

If global install is blocked by permissions:

```bash
npm install ./agent-continuity-runtime-1.0.0.tgz
node node_modules/agent-continuity-runtime/dist/acr.js --help
```

## Recommended packaging workflow

```bash
npm run build
npm --cache ./.npm-cache --logs-dir ./.npm-logs pack
```

Deliver the resulting `.tgz` file, not the whole repo.

## Important license note

The repository currently declares `Apache-2.0` in `package.json` and ships an
Apache license file. If you want to restrict redistribution or resale, replace
the current license with your intended commercial license before selling it as a
proprietary product.
