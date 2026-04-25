# 📚 Learning Companion

An AI-powered learning companion built at **Prompt Wars Pune Hackathon**.

Upload your study material (PDFs, notes) and let AI break it down into structured courses, topics, and interactive lessons — then quiz yourself and track your progress.

## ✨ Features

- 🗂️ **Course & Topic Organization** — Auto-structured learning paths from your content
- 🤖 **AI-Powered Lessons** — Get clear, digestible explanations generated from your material
- 💬 **Side Chat** — Ask questions while studying, with full topic context
- 🧒 **"Explain Like I'm 5"** — One-click simplified explanations
- 📝 **Quizzes** — Test your understanding after each topic
- 🏆 **Progress Tracking** — See your scores and completed topics

## 🚀 Future Scope

See [FUTURE_SCOPE.md](./FUTURE_SCOPE.md) for planned features including subtopics, RAG-based generation, streaks, knowledge maps, and more.

## 🛠️ Built With

- Google Gemini API
- Built during Prompt Wars Pune 2026

## ☁️ GCP / Vertex AI

Current status:
This project is now configured to use Vertex AI on GCP for AI generation.

To use Vertex AI locally, put these values in your repo-root `.env` or `backend/.env`:

```bash
GOOGLE_CLOUD_PROJECT="learning-front-2604"
GOOGLE_CLOUD_LOCATION="us-central1"
GOOGLE_APPLICATION_CREDENTIALS="./secrets/vertex-service-account.json"
```

Important:
For backend access to Vertex AI, a `client id` by itself is not enough. You also need:

- A real GCP project ID
- Vertex AI API enabled in that project
- Credentials for the backend, usually a service-account JSON file referenced by `GOOGLE_APPLICATION_CREDENTIALS`

The backend now loads `.env` explicitly from:

- repo root: `.env`
- backend folder: `backend/.env`

If `GOOGLE_APPLICATION_CREDENTIALS` is a relative path, it will be resolved automatically.

Alternative local auth:
You can still use `gcloud auth application-default login`, but it is no longer required if your `.env` points to a valid service-account JSON file.

For Cloud Run deployment, attach a service account with at least:

- `roles/aiplatform.user`
- `roles/logging.logWriter`

### Deploy To Cloud Run

This app can run as a single container because the FastAPI backend serves the built frontend.

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com aiplatform.googleapis.com

gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/learning-companion

gcloud run deploy learning-companion \
  --image gcr.io/YOUR_PROJECT_ID/learning-companion \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,GOOGLE_CLOUD_LOCATION=us-central1
```

If you want, the next step can be adding a production-ready `cloudbuild.yaml` and a small deployment script for your exact GCP project.

---

*Made with ☕ and AI at Prompt Wars Pune*
