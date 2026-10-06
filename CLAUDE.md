# MetaAgri – multi-agent digital twin of farms (sibling of MetaHospital)

MetaAgri is MetaHospital's concept moved to agriculture: field agents (petals) propose the day's
farm work, a Coordinator bundles them, a deterministic Safety check blocks unsafe/illegal work,
the farm manager approves or rejects, and neighbouring farms are agents too (machinery ring).
`DESIGN.md` is the contract between the parts. Reference implementation: MetaHospital's
Python/Flower twin in the git history of `../MetaHospital` (commit `0f842b7`,
`git -C ../MetaHospital show 0f842b7:<path>`); its working tree has since moved to a static web MVP.

## Flower rules (Flower 1.37)
- Agents are Flower AgentApps: flwr.agentapp (AgentApp, AgentSession).
- AgentSession exposes ONLY agent.connectors and agent.events. Nothing else.
- Model calls go through the OpenAI SDK:
    client = OpenAI(base_url=os.environ["FLWR_RUNTIME_BASE_URL"],
                    api_key=os.environ["FLWR_RUNTIME_API_KEY"], max_retries=0)
  These two variables are injected by Flower at runtime. Never set or log them.
- Do NOT use agent.responses. Do NOT use the old flwr.client API.
- Working template: agents/agent (from @flwrlabs/agent). Copy it for new agents.
- Run an agent: uv run flwr run . supergrid --stream
- Reference source: ../flower/framework/py/flwr/agentapp
- Docs: https://flower.ai/docs/agent/

## Repo layout
- agents/   Flower AgentApps (agents/agent = template, agents/petal = field/farm agent)
- hub/      FastAPI farm digital twin (state, weather/crop sim, Coordinator, Safety check)
- ui/       Streamlit dashboard (Earth → Germany → Oderbruch → Farm → Field)
- scripts/  demo.sh

## Ports
- hub: 8100, ui: 8601 (so MetaHospital on 8000/8501 can run at the same time)

## Working style
- Small steps, ask before large refactors.
- Use uv for Python (uv add, uv run). Never pip install.
- Prefer simple code over clever code; this is a hackathon MVP.
- Farm names are fictional on purpose (Hof Lerchenbruch, Gut Rohrdommelsee, Agrarhof Oderblick);
  never use a real farm's or company's name with simulated numbers.
- Python is 3.14: don't use altair / st.*_chart (broken) — charts are hand-rolled SVG/HTML.
