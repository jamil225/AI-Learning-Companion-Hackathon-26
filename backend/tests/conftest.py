import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"


@pytest.fixture
def backend_module(monkeypatch):
    monkeypatch.chdir(BACKEND_DIR)
    sys.path.insert(0, str(BACKEND_DIR))
    sys.modules.pop("main", None)
    module = importlib.import_module("main")
    module.state["progress"] = {"xp": 0, "completed_count": 0, "topics": {}}
    module.state["uploaded_notes"] = {}
    module.state["chat_history"] = {}
    yield module
    sys.modules.pop("main", None)
    try:
        sys.path.remove(str(BACKEND_DIR))
    except ValueError:
        pass


@pytest.fixture
def client(backend_module):
    return TestClient(backend_module.app)
