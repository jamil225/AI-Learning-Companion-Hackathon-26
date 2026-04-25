from io import BytesIO


class FakeResponse:
    def __init__(self, text):
        self.text = text


class FakeClient:
    def __init__(self, reply_text):
        self.reply_text = reply_text
        self.calls = []
        self.models = self

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        return FakeResponse(self.reply_text)


class FakePage:
    def __init__(self, text):
        self._text = text

    def extract_text(self):
        return self._text


class FakePDF:
    def __init__(self, pages):
        self.pages = pages

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_get_subjects_returns_curriculum(client, backend_module):
    response = client.get("/subjects")

    assert response.status_code == 200
    assert response.json() == backend_module.curriculum


def test_curriculum_path_is_resolved_relative_to_backend_module(backend_module):
    assert backend_module.CURRICULUM_PATH == backend_module.BASE_DIR / "curriculum.json"


def test_get_progress_returns_initial_state(client):
    response = client.get("/progress")

    assert response.status_code == 200
    assert response.json() == {"xp": 0, "completed_count": 0, "topics": {}}


def test_generate_lesson_returns_500_when_client_missing(client, backend_module):
    backend_module.client = None
    backend_module.client_init_error = "Vertex AI auth not configured"

    response = client.post(
        "/lesson",
        json={"topic_id": "cs_1", "difficulty": "beginner", "user_prompt": ""},
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "Vertex AI auth not configured"


def test_generate_lesson_uses_notes_and_user_prompt(client, backend_module):
    fake_client = FakeClient("Generated lesson")
    backend_module.client = fake_client
    backend_module.state["uploaded_notes"]["cs_1"] = "Notes from PDF"

    response = client.post(
        "/lesson",
        json={
            "topic_id": "cs_1",
            "difficulty": "advanced",
            "user_prompt": "Focus on examples",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "message": "Generated lesson",
        "topic_id": "cs_1",
        "difficulty": "advanced",
    }
    assert fake_client.calls[0]["model"] == "gemini-2.5-pro"
    assert "Focus on examples" in fake_client.calls[0]["contents"]
    assert "Notes from PDF" in fake_client.calls[0]["contents"]


def test_generate_lesson_returns_502_when_model_text_is_empty(client, backend_module):
    backend_module.client = FakeClient("")

    response = client.post(
        "/lesson",
        json={"topic_id": "cs_1", "difficulty": "beginner", "user_prompt": ""},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "Gemini returned an empty response while generating the lesson."


def test_generate_quiz_requests_exactly_five_questions(client, backend_module):
    fake_client = FakeClient('[{"question":"Q1","options":["A","B"],"answer":"A"}]')
    backend_module.client = fake_client

    response = client.post(
        "/quiz",
        json={"topic_id": "cs_1", "difficulty": "beginner", "user_prompt": ""},
    )

    assert response.status_code == 200
    assert response.json()["message"] == fake_client.reply_text
    assert "Generate exactly 5 multiple-choice questions" in fake_client.calls[0]["contents"]


def test_evaluate_quiz_marks_completed_topic_and_updates_progress(client, backend_module):
    response = client.post("/quiz/evaluate", json={"topic_id": "cs_1", "score": 4, "total": 5})

    assert response.status_code == 200
    assert response.json() == {
        "message": "Progress updated successfully",
        "passed": True,
        "xp_gained": 40,
        "new_total_xp": 40,
        "completed_count": 1,
    }
    assert backend_module.state["progress"]["topics"]["cs_1"] == {
        "score": 4,
        "total": 5,
        "passed": True,
    }
    completed_topic = backend_module.curriculum["courses"][0]["topics"][0]
    assert completed_topic["status"] == "completed"


def test_evaluate_quiz_marks_topic_in_progress_when_below_threshold(client, backend_module):
    response = client.post("/quiz/evaluate", json={"topic_id": "cs_2", "score": 3, "total": 5})

    assert response.status_code == 200
    assert response.json()["passed"] is False
    assert response.json()["xp_gained"] == 30
    assert response.json()["completed_count"] == 0
    assert backend_module.state["progress"]["topics"]["cs_2"] == {
        "score": 3,
        "total": 5,
        "passed": False,
    }
    in_progress_topic = backend_module.curriculum["courses"][0]["topics"][1]
    assert in_progress_topic["status"] == "in-progress"


def test_evaluate_quiz_returns_404_for_unknown_topic(client):
    response = client.post("/quiz/evaluate", json={"topic_id": "missing", "score": 4, "total": 5})

    assert response.status_code == 404
    assert response.json()["detail"] == "Topic not found"


def test_chat_returns_reply_and_persists_history(client, backend_module):
    fake_client = FakeClient("Tutor answer")
    backend_module.client = fake_client
    backend_module.state["chat_history"]["cs_1"] = [
        {"role": "user", "text": "Older question"},
        {"role": "tutor", "text": "Older answer"},
    ]

    response = client.post("/chat", json={"topic_id": "cs_1", "message": "New question"})

    assert response.status_code == 200
    assert response.json() == {"reply": "Tutor answer"}
    assert "Older question" in fake_client.calls[0]["contents"]
    assert backend_module.state["chat_history"]["cs_1"][-2:] == [
        {"role": "user", "text": "New question"},
        {"role": "tutor", "text": "Tutor answer"},
    ]


def test_upload_rejects_non_pdf_files(client):
    response = client.post(
        "/upload",
        data={"topic_id": "cs_1"},
        files={"file": ("notes.txt", b"plain text", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Only PDF files are supported."


def test_upload_rejects_pdf_over_twenty_pages(client, backend_module, monkeypatch):
    def fake_open(_file):
        return FakePDF([FakePage("page")] * 21)

    monkeypatch.setattr(backend_module.pdfplumber, "open", fake_open)

    response = client.post(
        "/upload",
        data={"topic_id": "cs_1"},
        files={"file": ("notes.pdf", b"%PDF", "application/pdf")},
    )

    assert response.status_code == 400
    assert "PDF exceeds 20 pages limit." in response.json()["detail"]


def test_upload_stores_extracted_pdf_text(client, backend_module, monkeypatch):
    def fake_open(_file):
        return FakePDF([FakePage("First page"), FakePage("Second page")])

    monkeypatch.setattr(backend_module.pdfplumber, "open", fake_open)

    response = client.post(
        "/upload",
        data={"topic_id": "cs_1"},
        files={"file": ("notes.pdf", BytesIO(b"%PDF"), "application/pdf")},
    )

    assert response.status_code == 200
    assert response.json() == {
        "message": "PDF uploaded and parsed successfully",
        "length": len("First page\nSecond page\n"),
    }
    assert backend_module.state["uploaded_notes"]["cs_1"] == "First page\nSecond page\n"


def test_upload_rejects_pdf_without_readable_text(client, backend_module, monkeypatch):
    def fake_open(_file):
        return FakePDF([FakePage(""), FakePage(None)])

    monkeypatch.setattr(backend_module.pdfplumber, "open", fake_open)

    response = client.post(
        "/upload",
        data={"topic_id": "cs_1"},
        files={"file": ("notes.pdf", BytesIO(b"%PDF"), "application/pdf")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "No readable text found in the PDF. Please upload a text-based PDF."
