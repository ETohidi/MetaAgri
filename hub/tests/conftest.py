import pytest
from fastapi.testclient import TestClient

from hub import main
from helpers import fresh_state


@pytest.fixture
def state():
    return fresh_state(seed=0)


@pytest.fixture
def client(monkeypatch):
    """The real app (module-level STATE), in mock mode, freshly reset with a fixed seed."""
    monkeypatch.setattr(main, "PETAL_MODE", "mock")
    test_client = TestClient(main.app)
    assert test_client.post("/reset", params={"seed": 0}).status_code == 200
    return test_client
