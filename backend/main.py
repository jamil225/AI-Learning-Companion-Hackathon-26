from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
import subprocess
from pathlib import Path
from google import genai
from google.genai import types
from google.auth import default as google_auth_default
import google.cloud.logging as cloud_logging
import pdfplumber
from dotenv import load_dotenv
import logging

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

load_dotenv(ROOT_DIR / ".env")
load_dotenv(BASE_DIR / ".env", override=True)


def normalize_google_credentials_path() -> None:
    credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if not credentials_path:
        return
    candidate = Path(credentials_path).expanduser()
    if not candidate.is_absolute():
        root_candidate = (ROOT_DIR / candidate).resolve()
        backend_candidate = (BASE_DIR / candidate).resolve()
        candidate = root_candidate if root_candidate.exists() else backend_candidate
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(candidate)


normalize_google_credentials_path()

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Set up Google Cloud Logging (sends logs to Cloud Logging on GCP)
try:
    cloud_log_client = cloud_logging.Client(project=os.getenv("GOOGLE_CLOUD_PROJECT"))
    cloud_log_client.setup_logging()
    logger.info("Google Cloud Logging enabled for project: %s", os.getenv("GOOGLE_CLOUD_PROJECT"))
except Exception as _cloud_log_err:
    logger.info("Google Cloud Logging not available locally, using standard logging: %s", _cloud_log_err)

client_init_error = "Vertex AI client not initialized"

app = FastAPI(title="Learning Companion API")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Gemini SDK
def is_truthy_env(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def detect_gcp_project() -> str | None:
    env_project = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCLOUD_PROJECT")
    if env_project:
        return env_project

    try:
        _, detected_project = google_auth_default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        if detected_project:
            logger.info("Detected Google Cloud project from Application Default Credentials: %s", detected_project)
            return detected_project
    except Exception as exc:
        logger.info("Could not detect Google Cloud project from ADC: %s", exc)

    try:
        result = subprocess.run(
            ["gcloud", "config", "get-value", "project"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        detected_project = result.stdout.strip()
        if detected_project and detected_project != "(unset)":
            logger.info("Detected Google Cloud project from gcloud config: %s", detected_project)
            return detected_project
    except Exception as exc:
        logger.info("Could not detect Google Cloud project from gcloud config: %s", exc)

    return None


def detect_google_credentials():
    try:
        credentials, _ = google_auth_default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        logger.info("Detected Google Application Default Credentials for Vertex AI")
        return credentials
    except Exception as exc:
        logger.info("Could not detect Google Application Default Credentials: %s", exc)
        return None


def build_genai_client():
    global client_init_error
    project = detect_gcp_project()
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    credentials = detect_google_credentials()

    try:
        if not project:
            raise ValueError(
                "Could not determine a Google Cloud project for Vertex AI. "
                "Set GOOGLE_CLOUD_PROJECT or run `gcloud config set project YOUR_PROJECT_ID`."
            )

        if not credentials:
            raise ValueError(
                "Could not find Google Application Default Credentials. "
                "Run `gcloud auth application-default login`."
            )

        logger.info("Initializing Google GenAI client with Vertex AI for project=%s, location=%s", project, location)
        return genai.Client(
            vertexai=True,
            project=project,
            location=location,
            credentials=credentials,
            http_options=types.HttpOptions(api_version="v1"),
        )
    except Exception as e:
        client_init_error = (
            "Could not initialize the Vertex AI client. "
            "Run `gcloud auth application-default login`, ensure a GCP project is selected, "
            "and set GOOGLE_CLOUD_LOCATION if needed. "
            f"Startup error: {e}"
        )
        print(
            "Warning: Could not initialize the Vertex AI client. "
            "Configure Application Default Credentials plus GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION. "
            f"Error: {e}"
        )
        return None


client = build_genai_client()

# In-memory storage
CURRICULUM_PATH = BASE_DIR / "curriculum.json"

try:
    with CURRICULUM_PATH.open("r", encoding="utf-8") as f:
        curriculum = json.load(f)
except FileNotFoundError as e:
    logger.error("Could not load curriculum file at %s", CURRICULUM_PATH)
    raise RuntimeError(f"Missing curriculum file: {CURRICULUM_PATH}") from e

# student progress, uploaded notes, chat history per topic
state = {
    "progress": {
        "xp": 0,
        "completed_count": 0,
        "topics": {} # Map of topic_id to progress info
    },
    "uploaded_notes": {}, # topic_id -> "text content"
    "chat_history": {} # topic_id -> list of messages
}

QUIZ_QUESTION_COUNT = 5
QUIZ_PASSING_SCORE = 4
XP_PER_CORRECT_ANSWER = 10

class LessonRequest(BaseModel):
    topic_id: str
    difficulty: str = "beginner"
    user_prompt: str = ""

class QuizEvaluateRequest(BaseModel):
    topic_id: str
    score: int
    total: int

class ChatRequest(BaseModel):
    topic_id: str
    message: str


def require_model_text(response, action_name: str) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text

    logger.error("Gemini returned an empty response while %s", action_name)
    raise HTTPException(
        status_code=502,
        detail=f"Gemini returned an empty response while {action_name}.",
    )

@app.get("/subjects")
async def get_subjects():
    """List all courses with topics and status"""
    return curriculum

@app.get("/progress")
async def get_progress():
    """XP, completed count, scores"""
    return state["progress"]

@app.post("/lesson")
async def generate_lesson(req: LessonRequest):
    """Generate lesson (topic_id, difficulty)"""
    logger.info(f"Generating lesson for topic: {req.topic_id}, user_prompt: '{req.user_prompt}'")
    if not client:
        logger.error("Gemini client not initialized")
        raise HTTPException(status_code=500, detail=client_init_error)
    
    notes = state["uploaded_notes"].get(req.topic_id, "No notes provided.")
    prompt = f"Create a comprehensive lesson on topic '{req.topic_id}'. Difficulty: {req.difficulty}.\n"
    if req.user_prompt:
        prompt += f"The student specifically wants to focus on: {req.user_prompt}\n"
    prompt += f"Here are some notes to base it on (if any): {notes}\nFormat the lesson with markdown, clear headings, and bullet points."
    
    try:
        response = client.models.generate_content(
            model='gemini-2.5-pro',
            contents=prompt,
        )
        logger.info(f"Successfully generated lesson for {req.topic_id}")
        return {
            "message": require_model_text(response, "generating the lesson"),
            "topic_id": req.topic_id,
            "difficulty": req.difficulty,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating lesson: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/explain-simpler")
async def explain_simpler(req: LessonRequest):
    """Re-explain at lower level"""
    if not client:
        raise HTTPException(status_code=500, detail=client_init_error)
    
    notes = state["uploaded_notes"].get(req.topic_id, "No notes provided.")
    prompt = f"Explain the topic '{req.topic_id}' as if I am 5 years old. Make it extremely simple and use analogies. Base it loosely on these notes if relevant: {notes}"
    
    response = client.models.generate_content(
        model='gemini-2.0-flash',
        contents=prompt,
    )
    return {"message": require_model_text(response, "explaining the lesson in simpler terms")}

@app.post("/quiz")
async def generate_quiz(req: LessonRequest):
    """Generate MCQs for topic"""
    if not client:
        raise HTTPException(status_code=500, detail=client_init_error)
    
    notes = state["uploaded_notes"].get(req.topic_id, "No notes provided.")
    prompt = (
        f"Generate exactly {QUIZ_QUESTION_COUNT} multiple-choice questions for the topic "
        f"'{req.topic_id}'. Difficulty: {req.difficulty}. Notes: {notes}. "
        "Return the result in a clean JSON format with an array of objects, each containing "
        "'question', 'options' (array of strings), and 'answer' (the correct option string). "
        "Return ONLY JSON, no markdown blocks."
    )
    
    response = client.models.generate_content(
        model='gemini-2.0-flash',
        contents=prompt,
    )
    return {"message": require_model_text(response, "generating the quiz")}

@app.post("/quiz/evaluate")
async def evaluate_quiz(req: QuizEvaluateRequest):
    """Evaluate answers, return feedback + next action"""
    passed = req.total > 0 and req.score >= QUIZ_PASSING_SCORE
    xp_gained = req.score * XP_PER_CORRECT_ANSWER
    state["progress"]["xp"] += xp_gained
    state["progress"]["topics"][req.topic_id] = {
        "score": req.score,
        "total": req.total,
        "passed": passed,
    }

    topic_found = False
    for course in curriculum.get("courses", []):
        for topic in course.get("topics", []):
            if topic["id"] == req.topic_id:
                if passed and topic.get("status") != "completed":
                    topic["status"] = "completed"
                    state["progress"]["completed_count"] += 1
                elif not passed and topic.get("status") == "not-started":
                    topic["status"] = "in-progress"
                topic_found = True
                break
        if topic_found:
            break

    if not topic_found:
        raise HTTPException(status_code=404, detail="Topic not found")
    
    return {
        "message": "Progress updated successfully",
        "passed": passed,
        "xp_gained": xp_gained,
        "new_total_xp": state["progress"]["xp"],
        "completed_count": state["progress"]["completed_count"],
    }

@app.post("/chat")
async def chat(req: ChatRequest):
    """Topic-aware Q&A"""
    if not client:
        raise HTTPException(status_code=500, detail=client_init_error)
    
    notes = state["uploaded_notes"].get(req.topic_id, "No notes provided.")
    history = state["chat_history"].get(req.topic_id, [])
    
    history_context = "\n".join([f"{msg['role']}: {msg['text']}" for msg in history[-5:]])
    prompt = f"You are a helpful AI tutor. The topic is '{req.topic_id}'. Notes context: {notes}\nChat history:\n{history_context}\nStudent asks: {req.message}"
    
    response = client.models.generate_content(
        model='gemini-2.0-flash',
        contents=prompt,
    )

    if req.topic_id not in state["chat_history"]:
        state["chat_history"][req.topic_id] = []

    reply_text = require_model_text(response, "answering the chat question")
    state["chat_history"][req.topic_id].append({"role": "user", "text": req.message})
    state["chat_history"][req.topic_id].append({"role": "tutor", "text": reply_text})

    return {"reply": reply_text}

@app.post("/upload")
async def upload_pdf(topic_id: str = Form(...), file: UploadFile = File(...)):
    """PDF/text upload per topic (max 20 pages)"""
    logger.info(f"Received upload for topic {topic_id}: {file.filename}")
    if not file.filename.endswith('.pdf'):
        logger.warning(f"Invalid file type uploaded: {file.filename}")
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    text_content = ""
    try:
        with pdfplumber.open(file.file) as pdf:
            if len(pdf.pages) > 20:
                logger.warning(f"PDF too long: {len(pdf.pages)} pages")
                raise HTTPException(status_code=400, detail="PDF exceeds 20 pages limit.")
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                if page_text:
                    text_content += page_text + "\n"
        if not text_content.strip():
            logger.warning("No readable text found in uploaded PDF for %s", topic_id)
            raise HTTPException(
                status_code=400,
                detail="No readable text found in the PDF. Please upload a text-based PDF.",
            )
        logger.info(f"Successfully parsed PDF for {topic_id}, extracted {len(text_content)} characters")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error parsing PDF for {topic_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error parsing PDF: {str(e)}")
        
    state["uploaded_notes"][topic_id] = text_content
    return {"message": "PDF uploaded and parsed successfully", "length": len(text_content)}

@app.post("/revision-card")
async def generate_revision_card(req: LessonRequest):
    """Generate key points summary"""
    # TODO: Implement Gemini call
    return {"message": "Revision card generation not yet implemented"}

# Serve React frontend in production (when the dist build exists)
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    logger.info(f"Serving frontend from {FRONTEND_DIST}")
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8081)
