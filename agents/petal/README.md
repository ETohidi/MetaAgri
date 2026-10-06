---
tags: [agentapp]
dataset: []
framework: []
---

# petal

A Flower AgentApp for one field of Hof Lerchenbruch (`North`, `West`, or
`River`). It fetches (or receives) the field's census, asks the model for
today's farm work (irrigate, spray, harvest, ...), validates the reply
against the `Proposal` schema, and posts it to the MetaAgri hub.

With `agent.unit="FARM"` the same app is a **farm agent** instead: it
fetches (or receives) one farm's high-level census, asks the model how much
the farm can share with its neighbours today (combine, silo space), and
posts a `FarmCapacity` answer for the Machinery ring.

Copied from MetaHospital's Python twin (`git -C ../MetaHospital show
0f842b7:agents/petal/...`, itself a copy of `agents/agent`,
which stays untouched) and adapted: FAB name `agri-petal`, run-config keys
are `agent.unit` / `agent.farm` / `hub.url` / `agent.census`, and
`petal/schemas.py` is a standalone copy of the hub's
`Action`/`Proposal`/`FarmCapacity` models so this agent has no dependency
on `hub/`.

## Config

- `agent.unit` (default `"River"`): `"North"`, `"West"`, `"River"`, or `"FARM"`.
- `agent.farm` (required when `agent.unit="FARM"`): the farm's exact name,
  e.g. `"Gut Rohrdommelsee"`.
- `hub.url` (default `http://127.0.0.1:8100`): base URL of the running hub.
- `agent.census` (optional JSON string): if set, used instead of fetching
  `{hub.url}/census/{field}` (or `{hub.url}/farms/{farm}/census`). This is
  the SuperGrid fallback for when the agent can't reach the hub over HTTP.

## Build

```shell
uv sync
uv run flwr build
```

## Run

Local (hub must be running at `hub.url`, default `http://127.0.0.1:8100`):

```shell
uv run flwr run . --stream --run-config 'agent.unit="River"'
uv run flwr run . --stream --run-config 'agent.unit="FARM" agent.farm="Gut Rohrdommelsee"'
```

SuperGrid, with an inline census (no hub round trip). The census JSON is full of
double quotes, so it goes in a single-quoted TOML literal string - exactly what the
hub's grid mode builds (`hub/hub/main.py`, `_launch_grid_petal`); a `'` inside the
census would end that string, so the hub sends it as the JSON escape `\u0027`:

```shell
uv run flwr login supergrid
CENSUS=$(curl -s http://127.0.0.1:8100/census/River | sed "s/'/\\\\u0027/g")
uv run flwr run . supergrid --stream \
  --run-config "agent.unit=\"River\" agent.census='$CENSUS'"

CENSUS=$(curl -s "http://127.0.0.1:8100/farms/Gut%20Rohrdommelsee/census" | sed "s/'/\\\\u0027/g")
uv run flwr run . supergrid --stream \
  --run-config "agent.unit=\"FARM\" agent.farm=\"Gut Rohrdommelsee\" agent.census='$CENSUS'"
```

You normally don't run these by hand: `PETAL_MODE=grid` on the hub (or
`scripts/demo.sh grid`) launches all six agents (3 fields + 3 farms) every day.

The proposal (or farm capacity) is printed as the last line of stdout,
emitted as an agent event, and (if the hub is reachable) POSTed to
`{hub.url}/proposals` (or `{hub.url}/farm-capacity`). If the model's reply
can't be parsed, the agent answers conservatively instead: an empty
proposal, or zero spare capacity, with confidence 0.1.

## Learn more

See the [Flower Agent documentation](https://flower.ai/docs/agent/) for more
tutorials and guides.
