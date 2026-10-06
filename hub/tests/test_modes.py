"""PETAL_MODE=flower / grid mechanics with fake subprocesses - no real Flower run (that
needs the user's SuperGrid login), but the launch commands, the stdout parsing, the
self-POST and every fallback path run for real."""
import json
import re
import subprocess
import time
import tomllib

import pytest
from fastapi.testclient import TestClient

from hub import main
from hub.schemas import Bundle


class FakeProc:
    """Stands in for `uv run flwr run ...`: `hang` makes communicate(timeout=...) time out."""

    pid = 99_999_999  # no such process group, so _kill_process_tree's killpg is a no-op

    def __init__(self, stdout: str = "", returncode: int = 0, hang: bool = False):
        self.stdout_text, self._rc, self.hang = stdout, returncode, hang
        self.returncode = None

    def communicate(self, timeout=None):
        if self.hang and timeout is not None:
            raise subprocess.TimeoutExpired(cmd="flwr", timeout=timeout)
        self.returncode = self._rc
        return self.stdout_text, None

    def poll(self):
        return self.returncode


def _flower_parse(run_config: str) -> dict:
    """Same parsing as flwr.common.config.parse_config_args (Flower 1.37)."""
    pattern = re.compile(r"(\S+?)=(\'[^\']*\'|\"[^\"]*\"|\S+)")
    return tomllib.loads("\n".join(f"{k} = {v}" for k, v in pattern.findall(run_config)))


@pytest.fixture
def hub_client(monkeypatch):
    client = TestClient(main.app)
    client.post("/reset", params={"seed": 0})

    def fake_post(url, json, timeout):
        assert url.startswith(main.HUB_SELF_URL)
        return client.post(url.removeprefix(main.HUB_SELF_URL), json=json)

    monkeypatch.setattr(main.requests, "post", fake_post)
    return client


def test_petal_dir_and_self_url_defaults():
    assert main.PETAL_AGENT_DIR.parts[-3:] == ("MetaAgri", "agents", "petal")
    assert main.HUB_SELF_URL == "http://127.0.0.1:8100"


def test_launch_commands(monkeypatch):
    calls = []
    monkeypatch.setattr(main.subprocess, "Popen", lambda args, **kw: calls.append((args, kw)) or FakeProc())
    census = {"field": "River", "recent_rejections": ["farm manager's call: don't"], "note": "m³"}
    main._launch_flower_petal("River")
    main._launch_grid_petal("River", census)
    main._launch_grid_farm("Gut Rohrdommelsee", {"farm": "Gut Rohrdommelsee"})

    (flower_args, flower_kw), (grid_args, grid_kw), (farm_args, _) = calls
    assert flower_args[:5] == ["uv", "run", "flwr", "run", "."] and "supergrid" not in flower_args
    assert _flower_parse(flower_args[-1]) == {"agent": {"unit": "River"}, "hub": {"url": "http://127.0.0.1:8100"}}
    assert grid_args[:8] == ["uv", "run", "flwr", "run", ".", "supergrid", "--stream", "--run-config"]
    parsed = _flower_parse(grid_args[-1])
    assert parsed["agent"]["unit"] == "River"
    assert json.loads(parsed["agent"]["census"]) == census  # the apostrophe survives the round trip
    farm = _flower_parse(farm_args[-1])["agent"]
    assert farm["unit"] == "FARM" and farm["farm"] == "Gut Rohrdommelsee"
    assert json.loads(farm["census"]) == {"farm": "Gut Rohrdommelsee"}
    for kw in (flower_kw, grid_kw):
        assert kw["cwd"] == main.PETAL_AGENT_DIR and kw["start_new_session"] is True


def test_extract_last_json_object():
    proposal = {"field": "North", "actions": [{"type": "harvest", "confidence": 0.9}], "rationale": "ripe", "confidence": 0.9}
    noisy = "Loading {project} ... {\"event\": 1}\n{ broken\n" + json.dumps(proposal) + "\nDone {"
    assert main._extract_last_json_object(noisy) == proposal
    assert main._extract_last_json_object("no json at all") is None


def test_grid_tick_parses_agents_and_falls_back(monkeypatch, hub_client):
    monkeypatch.setattr(main, "PETAL_MODE", "grid")
    north = {"field": "North", "actions": [{"type": "scout", "confidence": 0.9, "reason": "LLM says scout"}],
             "rationale": "LLM North plan", "confidence": 0.9}
    rohrdommelsee = {"farm": "Gut Rohrdommelsee", "can_share": {"combine": 1, "storage_t": 123}, "valid_until": "Wed 8 Jul",
                  "confidence": 0.77, "note": "from the LLM"}
    seen_censuses = {}

    def fake_petal(field, census):
        seen_censuses[field] = census
        if field == "North":
            return FakeProc(stdout="flwr noise {\n" + json.dumps(north) + "\n")
        if field == "West":
            return FakeProc(stdout="Traceback: model error", returncode=1)
        return FakeProc(hang=True)

    def fake_farm(name, census):
        if name == "Gut Rohrdommelsee":
            return FakeProc(stdout=json.dumps(rohrdommelsee))
        if name == "Agrarhof Oderblick":
            return FakeProc(stdout=json.dumps({"farm": "Agrarhof Oderblick", "can_share": {}, "confidence": 7}))
        return FakeProc(hang=True)

    monkeypatch.setattr(main, "_launch_grid_petal", fake_petal)
    monkeypatch.setattr(main, "_launch_grid_farm", fake_farm)

    bundle = main.tick()
    Bundle(**bundle)
    assert seen_censuses["River"]["field"] == "River" and seen_censuses["River"]["date"] == "Tue 7 Jul"
    by_field = {p["field"]: p for p in bundle["proposals"]}
    assert by_field["North"]["rationale"] == "LLM North plan"  # the model's answer, self-POSTed
    assert by_field["River"]["actions"][0]["type"] == "irrigate"  # mock fallback after the timeout
    caps = {c["farm"]: c for c in bundle["nearby_capacity"]}
    assert list(caps) == ["Hof Lerchenbruch", "Gut Rohrdommelsee", "Agrarhof Oderblick"]
    assert caps["Gut Rohrdommelsee"]["note"] == "from the LLM" and caps["Gut Rohrdommelsee"]["confidence"] == 0.77
    assert caps["Agrarhof Oderblick"]["note"].startswith("combine")  # invalid answer -> mock
    warns = [e["text"] for e in main.STATE.log if e["level"] == "warn"]
    assert any(t.startswith("West field agent exited (rc=1) with no parseable JSON") for t in warns)
    assert "River field agent did not respond within 90s; falling back to mock" in warns
    assert "Hof Lerchenbruch did not respond within 90s; using a conservative estimate" in warns
    assert any(t.startswith("Agrarhof Oderblick's capacity answer failed self-POST (self-POST returned 422") for t in warns)
    assert main.TICK_IN_PROGRESS is False


def test_flower_mode_waits_for_self_post_and_falls_back(monkeypatch, hub_client):
    monkeypatch.setattr(main, "PETAL_MODE", "flower")
    monkeypatch.setattr(main, "FLOWER_POLL_INTERVAL_SECONDS", 0.01)

    def fake_launch(field):
        proc = FakeProc()
        if field == "West":
            hub_client.post("/proposals", json={"field": "West", "rationale": "local SuperLink answer", "confidence": 0.6})
        else:
            proc.returncode = 1  # died before posting anything
        return proc

    monkeypatch.setattr(main, "_launch_flower_petal", fake_launch)
    bundle = main.tick()
    by_field = {p["field"]: p for p in bundle["proposals"]}
    assert by_field["West"]["rationale"] == "local SuperLink answer"
    assert by_field["River"]["actions"][0]["type"] == "irrigate"  # mock
    warns = [e["text"] for e in main.STATE.log if e["level"] == "warn"]
    assert "North field agent did not respond within 90s; falling back to mock" in warns
    # farm capacity comes from the mock farm agents in flower mode
    assert [c["farm"] for c in bundle["nearby_capacity"]] == ["Hof Lerchenbruch", "Gut Rohrdommelsee", "Agrarhof Oderblick"]


def test_extract_last_json_object_ignores_braces_inside_strings():
    for rationale in ("Soil at 55% :-} irrigating 15 mm", "a lone { brace", "balanced {braces} too"):
        proposal = {"field": "River", "actions": [{"type": "irrigate", "mm": 15, "reason": "fits permit"}],
                    "rationale": rationale, "confidence": 0.8, "risks": []}
        assert main._extract_last_json_object("flwr noise\n" + json.dumps(proposal) + "\n") == proposal
    # the petal's own parse-failure fallback quotes a truncated pydantic repr with unbalanced braces
    fallback = {"field": "River", "actions": [], "confidence": 0.1, "risks": ["model output parse failure"],
                "rationale": "Model output could not be parsed/validated (input_value={'field': 'River', 'confi... 'x'}]}); holding off"}
    assert main._extract_last_json_object(json.dumps(fallback)) == fallback


def test_launch_failure_falls_back_to_mock_with_a_warning(monkeypatch, hub_client):
    def no_uv(*args, **kwargs):
        raise FileNotFoundError(2, "No such file or directory", "uv")

    monkeypatch.setattr(main.subprocess, "Popen", no_uv)
    for mode, expected_plan_for in (("grid", "Tue 7 Jul"), ("flower", "Wed 8 Jul")):
        monkeypatch.setattr(main, "PETAL_MODE", mode)
        response = hub_client.post("/tick")
        assert response.status_code == 200, mode
        assert response.json()["plan_for"] == expected_plan_for
        warns = [e["text"] for e in main.STATE.log if e["level"] == "warn" and e["date"] == expected_plan_for]
        assert sum("could not be started" in t for t in warns) == (6 if mode == "grid" else 3), (mode, warns)
    assert main.TICK_IN_PROGRESS is False


def test_timeout_kills_the_group_and_keeps_an_answer_already_printed(monkeypatch, hub_client):
    """uv exits after printing the answer but a descendant keeps stdout open: the hub must not
    wait for the descendant, must kill it, and must still use the answer it already has."""
    monkeypatch.setattr(main, "PETAL_MODE", "grid")
    monkeypatch.setattr(main, "FLOWER_PROPOSAL_TIMEOUT_SECONDS", 1)
    answer = {"field": "River", "actions": [{"type": "scout", "confidence": 0.9}], "rationale": "printed before the hang", "confidence": 0.9}
    marker = "metaagri-test-sleeper"

    def lingering(field, census):
        script = f"echo '{json.dumps(answer)}'; (exec -a {marker} sleep 30 &); exit 0" if field == "River" else "exit 1"
        return subprocess.Popen(["bash", "-c", script], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, start_new_session=True)

    monkeypatch.setattr(main, "_launch_grid_petal", lingering)
    monkeypatch.setattr(main, "_launch_grid_farm", lambda name, census: FakeProc(stdout="", returncode=1))
    started = time.monotonic()
    bundle = main.tick()
    assert time.monotonic() - started < 15
    river = next(p for p in bundle["proposals"] if p["field"] == "River")
    assert river["rationale"] == "printed before the hang"
    leftover = subprocess.run(["pgrep", "-f", marker], capture_output=True, text=True).stdout.strip()
    assert leftover == "", f"sleeper still running: {leftover}"


def test_answer_for_another_field_or_farm_warns(monkeypatch, hub_client):
    monkeypatch.setattr(main, "PETAL_MODE", "grid")
    mislabelled = {"field": "North", "actions": [], "rationale": "River's model wrote North", "confidence": 0.5}
    wrong_farm = {"farm": "Rohrdommelsee", "can_share": {"combine": 1, "storage_t": 10}, "valid_until": "Wed 8 Jul", "confidence": 0.5}

    def fake_petal(field, census):
        return FakeProc(stdout=json.dumps(mislabelled)) if field == "River" else FakeProc(returncode=1)

    def fake_farm(name, census):
        return FakeProc(stdout=json.dumps(wrong_farm)) if name == "Gut Rohrdommelsee" else FakeProc(returncode=1)

    monkeypatch.setattr(main, "_launch_grid_petal", fake_petal)
    monkeypatch.setattr(main, "_launch_grid_farm", fake_farm)
    main.tick()
    warns = [e["text"] for e in main.STATE.log if e["level"] == "warn"]
    assert "River field agent answered for another field; falling back to mock" in warns
    assert "Gut Rohrdommelsee's agent answered for another farm; using a conservative estimate" in warns
