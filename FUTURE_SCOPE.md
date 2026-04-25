# Learning Companion — Future Scope

Features and enhancements planned for post-hackathon development.

---

## 1. Subtopics (3-Level Hierarchy)
- Extend current Course → Topic to **Course → Topic → Subtopic**
- Each topic breaks down into granular subtopics
- Example: Math → Algebra → Linear Equations, Quadratic Equations, Inequalities
- Independent progress tracking per subtopic
- Subtopics clickable in sidebar with expand/collapse

## 2. RAG-Based Lesson Generation
- Replace current direct text injection with proper RAG pipeline
- Chunk uploaded PDFs intelligently (by section/paragraph)
- Use embeddings (Gemini embeddings or sentence-transformers) for semantic search
- Vector store (ChromaDB / Pinecone) for efficient retrieval
- Retrieve most relevant chunks per lesson section instead of passing full text
- Benefits: handles large textbooks (100+ pages), more accurate content grounding

## 3. Streaks & Advanced Gamification
- Streak counter — "3 correct in a row!" notifications
- Daily learning streaks
- Badges for milestones (first topic, first course, perfect quiz)
- Leaderboard (multi-user)
- XP multipliers for streaks

## 4. Visual Knowledge Map
- Interactive grid/graph of all topics
- Color-coded by mastery: red (not started) → yellow (in progress) → green (mastered)
- Click to navigate directly to any topic

## 5. Session Recap
- End-of-session summary: "Today you learned X, struggled with Y, focus on Z next time"
- Tracks time spent per topic
- Suggests what to study next

## 6. Multi-User Support
- User authentication (Google OAuth)
- Per-user progress persistence
- Database backend (PostgreSQL)

## 7. Image/Handwritten Notes Support
- OCR for handwritten notes (Google Cloud Vision API)
- Accept image uploads alongside PDF/text

## 8. Flashcard-Style Revision
- Extend revision cards with spaced repetition (SM-2 algorithm)
- Question on front, answer on back
- Focus on weak areas from quiz results

## 9. Voice Interaction
- Text-to-speech for lesson content (accessibility)
- Speech-to-text for chat input
- Conversational tutoring via voice

## 10. Analytics Dashboard
- Learning velocity tracking
- Time spent per topic
- Quiz score trends over time
- Strengths/weaknesses heatmap
