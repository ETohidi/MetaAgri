"""MetaAgri hub: the farm digital twin FastAPI app."""
import json
import os
import signal
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

import requests
from fastapi import FastAPI, HTTPException

from hub import mock_farms, mock_petals, notices, sim, stem, thorn
from hub.schemas import DecideRequest, FarmCapacity, FarmCensus, FieldCensus, Proposal
from hub.state import FARM_IDS, FARM_NAMES, FIELD_AGENT_NAME, FIELD_DISPLAY_NAME, FIELDS, HubState

PETAL_MODE = os.environ.get("PETAL_MODE", "mock")  # "mock" | "flower" | "grid"
HUB_SELF_URL = os.environ.get("HUB_SELF_URL", "http://127.0.0.1:8100")
PETAL_AGENT_DIR = Path(__file__).resolve().parents[2] / "agents" / "petal"
FLOWER_PROPOSAL_TIMEOUT_SECONDS = 90
FLOWER_POLL_INTERVAL_SECONDS = 0.5

app = FastAPI(title="MetaAgri Hub")
STATE = HubState()
TICK_IN_PROGRESS = False  # set and cleared only while TICK_LOCK is held
# FastAPI runs these sync endpoints in a thread pool. A grid/flower tick takes up to 90 s,
# so one lock keeps a second /tick, a /reset, a scenario or a /decide from landing in the
# middle of it (two plans for one day, a stale plan in a fresh season). /proposals and
# /farm-capacity stay unlocked: the agents self-POST to them *during* a tick.
TICK_LOCK = threading.Lock()


@contextmanager
def _exclusive():
    if not TICK_LOCK.acquire(blocking=False):
        detail = "a day is already being planned" if TICK_IN_PROGRESS else "the farm is busy with another change"
        raise HTTPException(409, f"{detail}; try again in a moment")
    try:
        yield
    finally:
        TICK_LOCK.release()


def _kill_process_tree(proc: subprocess.Popen) -> None:
    """`uv run flwr run ...` keeps running as a parent of the actual submission
    process and doesn't forward signals to it - proc.kill()/.terminate() alone
    leaves it running, so every launcher below starts its process in a new session
    (start_new_session=True) and this kills the whole group, not just uv itself.
    Even when uv itself has already exited: a descendant can outlive it and keep
    stdout open, which is exactly the case this is for."""
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def _communicate(proc: subprocess.Popen) -> tuple[str, bool]:
    """Wait up to the per-agent timeout for the agent's stdout -> (stdout, timed_out).
    On a timeout, kill the process group and keep whatever it had printed: the answer
    may already be there even though something still held the pipe open."""
    try:
        stdout_text, _ = proc.communicate(timeout=FLOWER_PROPOSAL_TIMEOUT_SECONDS)
        return stdout_text or "", False
    except subprocess.TimeoutExpired:
        _kill_process_tree(proc)
    try:
        stdout_text, _ = proc.communicate(timeout=5)
    except subprocess.TimeoutExpired as exc:  # a process outside the group still holds the pipe
        stdout_text = exc.stdout or ""
        if isinstance(stdout_text, bytes):
            stdout_text = stdout_text.decode(errors="replace")
    return stdout_text or "", True


# -- PETAL_MODE=flower: local SuperLink, one field at a time, petal self-POSTs ----
def _launch_flower_petal(field: str) -> subprocess.Popen:
    return subprocess.Popen(
        ["uv", "run", "flwr", "run", ".", "--run-config", f'agent.unit="{field}" hub.url="{HUB_SELF_URL}"'],
        cwd=PETAL_AGENT_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def _wait_for_flower_proposal(state: HubState, field: str, proc: subprocess.Popen) -> Proposal | None:
    deadline = time.monotonic() + FLOWER_PROPOSAL_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        raw = state.pending_flower_proposals.get(field)
        if raw is not None:
            _kill_process_tree(proc)
            return Proposal(**raw)
        if proc.poll() is not None and proc.returncode != 0:
            break  # subprocess died before posting a proposal; no point waiting out the timeout
        time.sleep(FLOWER_POLL_INTERVAL_SECONDS)
    _kill_process_tree(proc)
    return None


def _collect_flower_proposals(state: HubState) -> list[Proposal]:
    proposals = []
    for field in FIELDS:
        state.pending_flower_proposals.pop(field, None)
        try:
            proc = _launch_flower_petal(field)
        except OSError as exc:  # uv not on PATH, agents/petal missing, ...
            state.add_log(actor="Farm", level="warn", text=f"{FIELD_AGENT_NAME[field]} could not be started ({exc}); falling back to mock")
            proposals.append(mock_petals.generate(field, state))
            continue
        proposal = _wait_for_flower_proposal(state, field, proc)
        if proposal is None:
            state.add_log(
                actor="Farm",
                level="warn",
                text=f"{FIELD_AGENT_NAME[field]} did not respond within {FLOWER_PROPOSAL_TIMEOUT_SECONDS}s; falling back to mock",
            )
            proposal = mock_petals.generate(field, state)
        proposals.append(proposal)
    return proposals


# -- PETAL_MODE=grid: real SuperGrid, all fields in parallel, census inlined ------
def _census_run_config_json(census: dict) -> str:
    """The census goes into a single-quoted (TOML literal) run-config string, which can't
    contain a ' - and the farm manager's free-text rejection reasons can. JSON's \\u0027
    escape survives the literal string untouched and decodes back to ' in the petal."""
    return json.dumps(census).replace("'", "\\u0027")


def _launch_grid_petal(field: str, census: dict) -> subprocess.Popen:
    census_json = _census_run_config_json(census)
    run_config = f'agent.unit="{field}" agent.census=\'{census_json}\''
    return subprocess.Popen(
        ["uv", "run", "flwr", "run", ".", "supergrid", "--stream", "--run-config", run_config],
        cwd=PETAL_AGENT_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        start_new_session=True,
    )


def _extract_last_json_object(text: str) -> dict | None:
    """Find the JSON object in text that ends last (the petal prints its answer last).

    Tries every '{' as a candidate start with a real JSON decoder, so braces inside
    strings (a model's reason, the petal's own parse-failure message) can't throw the
    scan off, and neither can a stray unmatched '{' earlier in noisy CLI output. A
    nested object (e.g. one action dict inside a Proposal's "actions" list) always
    ends *before* its parent, so the outer, complete object wins.
    """
    decoder = json.JSONDecoder()
    best: tuple[int, dict] | None = None
    for start, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            parsed, end = decoder.raw_decode(text, start)
        except json.JSONDecodeError:
            continue
        if best is None or end > best[0]:
            best = (end, parsed)
    return best[1] if best else None


def _submit_parsed_proposal(parsed: dict) -> tuple[bool, str]:
    try:
        response = requests.post(f"{HUB_SELF_URL}/proposals", json=parsed, timeout=5)
        if response.status_code < 400:
            return True, ""
        return False, f"self-POST returned {response.status_code}: {response.text[:300]}"
    except requests.RequestException as exc:
        return False, f"self-POST raised {exc!r}"


def _run_grid_petal(state: HubState, field: str, census: dict) -> Proposal:
    """Runs in a worker thread: launch, block-wait up to the per-field timeout
    (draining stdout as it goes via communicate(), which also avoids a pipe-buffer
    deadlock if a petal's output exceeds the OS pipe buffer while still running),
    then parse/submit or fall back to mock."""
    agent = FIELD_AGENT_NAME[field]
    try:
        proc = _launch_grid_petal(field, census)
    except OSError as exc:  # uv not on PATH, agents/petal missing, ...
        state.add_log(actor="Farm", level="warn", text=f"{agent} could not be started ({exc}); falling back to mock")
        return mock_petals.generate(field, state)
    stdout_text, timed_out = _communicate(proc)

    parsed = _extract_last_json_object(stdout_text)
    if parsed is None:
        problem = (
            f"did not respond within {FLOWER_PROPOSAL_TIMEOUT_SECONDS}s"
            if timed_out
            else f"exited (rc={proc.returncode}) with no parseable JSON in its output ({len(stdout_text)} chars captured)"
        )
        state.add_log(actor="Farm", level="warn", text=f"{agent} {problem}; falling back to mock")
        return mock_petals.generate(field, state)

    ok, detail = _submit_parsed_proposal(parsed)
    if not ok:
        state.add_log(
            actor="Farm",
            level="warn",
            text=f"{FIELD_AGENT_NAME[field]} parsed a proposal but the farm's self-POST failed ({detail}); falling back to mock",
        )
        return mock_petals.generate(field, state)

    raw = state.pending_flower_proposals.get(field)
    if raw is None:
        state.add_log(actor="Farm", level="warn", text=f"{agent} answered for another field; falling back to mock")
        return mock_petals.generate(field, state)
    return Proposal(**raw)


# -- farm agents (Machinery ring input): agent.unit="FARM" -------------------------
def _launch_grid_farm(farm_name: str, census: dict) -> subprocess.Popen:
    census_json = _census_run_config_json(census)
    run_config = f'agent.unit="FARM" agent.farm="{farm_name}" agent.census=\'{census_json}\''
    return subprocess.Popen(
        ["uv", "run", "flwr", "run", ".", "supergrid", "--stream", "--run-config", run_config],
        cwd=PETAL_AGENT_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        start_new_session=True,
    )


def _submit_parsed_capacity(parsed: dict) -> tuple[bool, str]:
    try:
        response = requests.post(f"{HUB_SELF_URL}/farm-capacity", json=parsed, timeout=5)
        if response.status_code < 400:
            return True, ""
        return False, f"self-POST returned {response.status_code}: {response.text[:300]}"
    except requests.RequestException as exc:
        return False, f"self-POST raised {exc!r}"


def _run_grid_farm(state: HubState, farm_name: str, census: dict) -> dict:
    try:
        proc = _launch_grid_farm(farm_name, census)
    except OSError as exc:
        state.add_log(
            actor="Machinery ring",
            level="warn",
            text=f"{farm_name}'s agent could not be started ({exc}); using a conservative estimate",
        )
        return mock_farms.generate(farm_name, state)
    stdout_text, timed_out = _communicate(proc)

    parsed = _extract_last_json_object(stdout_text)
    if parsed is None:
        problem = (
            f"did not respond within {FLOWER_PROPOSAL_TIMEOUT_SECONDS}s"
            if timed_out
            else f"gave no parseable capacity answer (rc={proc.returncode})"
        )
        state.add_log(actor="Machinery ring", level="warn", text=f"{farm_name} {problem}; using a conservative estimate")
        return mock_farms.generate(farm_name, state)

    ok, detail = _submit_parsed_capacity(parsed)
    if not ok:
        state.add_log(
            actor="Machinery ring",
            level="warn",
            text=f"{farm_name}'s capacity answer failed self-POST ({detail}); using a conservative estimate",
        )
        return mock_farms.generate(farm_name, state)

    raw = state.pending_farm_capacity.get(farm_name)
    if raw is None:
        state.add_log(
            actor="Machinery ring",
            level="warn",
            text=f"{farm_name}'s agent answered for another farm; using a conservative estimate",
        )
        return mock_farms.generate(farm_name, state)
    return raw


def _collect_grid_tick_data(state: HubState) -> tuple[list[Proposal], dict]:
    """Field agents and farm agents run in the *same* thread pool batch, truly
    concurrently (not field agents first, farm agents after)."""
    censuses = {field: state.census(field).model_dump() for field in FIELDS}
    farm_censuses = {name: state.farm_census(name).model_dump() for name in FARM_NAMES}
    for field in FIELDS:
        state.pending_flower_proposals.pop(field, None)
    for name in FARM_NAMES:
        state.pending_farm_capacity.pop(name, None)

    with ThreadPoolExecutor(max_workers=len(FIELDS) + len(FARM_NAMES)) as executor:
        field_futures = {executor.submit(_run_grid_petal, state, field, censuses[field]): field for field in FIELDS}
        farm_futures = {executor.submit(_run_grid_farm, state, name, farm_censuses[name]): name for name in FARM_NAMES}
        proposals_by_field: dict[str, Proposal] = {}
        capacity_by_farm: dict[str, dict] = {}
        for future in as_completed([*field_futures, *farm_futures]):
            if future in field_futures:
                proposals_by_field[field_futures[future]] = future.result()
            else:
                capacity_by_farm[farm_futures[future]] = future.result()

    # Keep FARM_NAMES order (own farm first) regardless of which agent answered first.
    return [proposals_by_field[f] for f in FIELDS], {name: capacity_by_farm[name] for name in FARM_NAMES}


def _collect_tick_data(state: HubState) -> tuple[list[Proposal], dict]:
    if PETAL_MODE == "grid":
        return _collect_grid_tick_data(state)
    if PETAL_MODE == "flower":
        proposals = _collect_flower_proposals(state)
    else:
        proposals = [mock_petals.generate(field, state) for field in FIELDS]
    farm_capacity = {name: mock_farms.generate(name, state) for name in FARM_NAMES}
    return proposals, farm_capacity


def _farm_name(name: str) -> str:
    """Accept the farm's name ("Gut Rohrdommelsee") or its URL id ("rohrdommelsee")."""
    name = FARM_IDS.get(name, name)
    if name not in FARM_NAMES:
        raise HTTPException(404, f"unknown farm {name}")
    return name


def _check_field(field: str) -> None:
    if field not in FIELDS:
        raise HTTPException(404, f"unknown field {field}")


@app.get("/state")
def get_state():
    return STATE.to_dict()


@app.get("/census/{field}", response_model=FieldCensus)
def get_census(field: str):
    _check_field(field)
    return STATE.census(field)


@app.get("/farms/{name}/census", response_model=FarmCensus)
def get_farm_census(name: str):
    return STATE.farm_census(_farm_name(name))


@app.get("/history/farm/{name}")
def get_farm_history(name: str):
    return {"history": STATE.farm_history.get(_farm_name(name), [])}


@app.get("/history/{field}")
def get_history(field: str):
    _check_field(field)
    return {
        "history": STATE.history.get(field, []),
        "projection": STATE.projection(field),
        "stress_threshold_pct": STATE.fields[field].stress_threshold,
    }


@app.get("/plans/{field}")
def get_field_plans(field: str, limit: int = 3):
    _check_field(field)
    matches = []
    for b in reversed(STATE.bundles):
        proposal = next((p for p in b["proposals"] if p["field"] == field), None)
        if proposal is None:
            continue
        matches.append(
            {
                "bundle_id": b["bundle_id"],
                "plan_for": b["plan_for"],
                "status": b["status"],
                "confidence": proposal["confidence"],
            }
        )
        if len(matches) >= limit:
            break
    return matches


@app.get("/farm-reports/{name}")
def get_farm_reports(name: str, limit: int = 3):
    name = _farm_name(name)
    matches = []
    for b in reversed(STATE.bundles):
        report = next((r for r in b.get("nearby_capacity", []) if r["farm"] == name), None)
        if report is None:
            continue
        matches.append(
            {
                "plan_for": b["plan_for"],
                "can_share": report["can_share"],
                "confidence": report["confidence"],
                "note": report.get("note", ""),
            }
        )
        if len(matches) >= limit:
            break
    return matches


@app.post("/proposals", status_code=201)
def post_proposal(proposal: Proposal):
    STATE.add_log(
        actor=FIELD_AGENT_NAME.get(proposal.field, proposal.field),
        level="info",
        text=f"proposal received: {proposal.rationale}",
    )
    STATE.pending_flower_proposals[proposal.field] = proposal.model_dump(exclude_none=True)
    return {"ok": True}


@app.post("/farm-capacity", status_code=201)
def post_farm_capacity(capacity: FarmCapacity):
    STATE.pending_farm_capacity[capacity.farm] = capacity.model_dump()
    return {"ok": True}


@app.get("/status")
def get_status():
    return {"tick_in_progress": TICK_IN_PROGRESS, "mode": PETAL_MODE}


@app.post("/tick")
def tick():
    global TICK_IN_PROGRESS
    with _exclusive():
        TICK_IN_PROGRESS = True
        try:
            sim.step(STATE)
            proposals, farm_capacity = _collect_tick_data(STATE)
            STATE.recent_proposals = [p.field for p in proposals]
            bundle = stem.build_bundle(STATE, proposals, farm_capacity)
            return bundle
        finally:
            TICK_IN_PROGRESS = False


@app.post("/scenario/heatwave")
def scenario_heatwave():
    with _exclusive():
        return {"ok": True, "scenario": sim.start_heatwave(STATE)}


@app.post("/scenario/hail")
def scenario_hail():
    with _exclusive():
        return {"ok": True, "scenario": sim.hail_warning(STATE)}


@app.get("/inbox")
def inbox():
    return [b for b in STATE.bundles if b["status"] == "pending"]


def _blocked_now(bundle: dict) -> list[dict]:
    """Re-run the safety check on a pending plan against the twin as it is now. The plan
    was cleared when it was built; a scenario since then (a heatwave cuts today's water
    permit at once) can make it illegal. While nothing has changed, one pass over the whole
    plan clears exactly what the two build passes cleared (harvests and borrows are still
    booked before any delivery, and the field agents' actions before the Machinery ring's)."""
    proposals = [Proposal(**p) for p in bundle["proposals"]]
    entries, _, _, _ = thorn.evaluate(proposals, STATE)
    return [e for e in entries if e["blocked"]]


@app.post("/decide")
def decide(req: DecideRequest):
    with _exclusive():
        return _decide(req)


def _decide(req: DecideRequest) -> dict:
    bundle = next((b for b in STATE.bundles if b["bundle_id"] == req.bundle_id), None)
    if bundle is None:
        raise HTTPException(404, "plan not found")
    if bundle["status"] != "pending":
        raise HTTPException(400, f"plan already {bundle['status']}")

    fields_in_bundle = {p["field"] for p in bundle["proposals"]}

    if req.decision == "approve":
        blocked = _blocked_now(bundle)
        if blocked:
            what = "; ".join(
                f"{e['action'].get('type')} for {FIELD_DISPLAY_NAME.get(e['field'], e['field'])}: {e['rule'].rstrip('.')}"
                for e in blocked
            )
            STATE.add_log(
                actor="Safety check",
                level="block",
                text=f"the {bundle['plan_for']} plan no longer passes ({what}); reject it so the field agents re-plan",
            )
            raise HTTPException(409, f"plan no longer passes the safety check: {what}. Reject it so the field agents re-plan.")
        STATE.apply_bundle(bundle)
        bundle["status"] = "approved"
        for notice in notices.generate(bundle, STATE):
            STATE.add_notice(notice["audience"], notice["text"])
        STATE.add_log(actor="Farm manager", level="decision", text=f"approved the {bundle['plan_for']} plan")
    else:
        bundle["status"] = "rejected"
        bundle["reason"] = req.reason
        for field in fields_in_bundle:
            rejections = STATE.fields[field].recent_rejections
            rejections.append(req.reason or "rejected")
            STATE.fields[field].recent_rejections = rejections[-5:]
        reason_text = f": {req.reason}" if req.reason else ""
        STATE.add_log(actor="Farm manager", level="decision", text=f"rejected the {bundle['plan_for']} plan{reason_text}")

    return bundle


@app.get("/log")
def get_log():
    return list(reversed(STATE.log))


@app.get("/notices")
def get_notices():
    return list(reversed(STATE.notices))


@app.post("/reset")
def reset(seed: Optional[int] = None):
    with _exclusive():
        STATE.reset(seed)
        return {"ok": True}
