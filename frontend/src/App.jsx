import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import './App.css';

const PASSING_SCORE = 4;
const EMPTY_LESSON_MESSAGE = 'No study material text was returned. Please try again.';

function App() {
  const [courses, setCourses] = useState([]);
  const [progress, setProgress] = useState({ xp: 0, completed_count: 0 });
  const [selectedTopic, setSelectedTopic] = useState(null);
  
  // Topic configuration state
  const [isTopicConfigured, setIsTopicConfigured] = useState(false);
  const [userPrompt, setUserPrompt] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [collapsedCourses, setCollapsedCourses] = useState({});

  // Lesson state
  const [lessonContent, setLessonContent] = useState('');
  const [isLoadingLesson, setIsLoadingLesson] = useState(false);
  const [isQuizMode, setIsQuizMode] = useState(false);
  const [quizData, setQuizData] = useState([]);
  const [userAnswers, setUserAnswers] = useState({});
  const [quizStatus, setQuizStatus] = useState('');
  const [isLoadingQuiz, setIsLoadingQuiz] = useState(false);
  const [isSubmittingQuiz, setIsSubmittingQuiz] = useState(false);
  
  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    refreshCurriculum();
    refreshProgress();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const readJsonResponse = async (res, fallbackMessage) => {
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.detail || fallbackMessage);
    }

    return data;
  };

  const handleTopicSelect = (topic) => {
    setSelectedTopic(topic);
    setIsTopicConfigured(false);
    setLessonContent('');
    setUserPrompt('');
    setUploadStatus('');
    setChatMessages([]);
    setIsQuizMode(false);
    setQuizData([]);
    setUserAnswers({});
    setQuizStatus('');
  };

  const refreshCurriculum = async () => {
    try {
      const res = await fetch('/subjects');
      const data = await res.json();
      if (data && data.courses) {
        setCourses(data.courses);
        if (selectedTopic) {
          for (const course of data.courses) {
            const matchingTopic = course.topics.find(topic => topic.id === selectedTopic.id);
            if (matchingTopic) {
              setSelectedTopic(matchingTopic);
              break;
            }
          }
        }
      }
    } catch (err) {
      console.error("Error fetching courses:", err);
    }
  };

  const refreshProgress = async () => {
    try {
      const res = await fetch('/progress');
      const data = await res.json();
      setProgress(data);
    } catch (err) {
      console.error("Error fetching progress:", err);
    }
  };

  const loadLesson = async (topic, promptToUse = "") => {
    setIsTopicConfigured(true);
    setIsLoadingLesson(true);
    setChatMessages([]);
    setIsQuizMode(false);
    setQuizData([]);
    setUserAnswers({});
    setQuizStatus('');

    try {
      const res = await fetch('/lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: topic.id, difficulty: 'beginner', user_prompt: promptToUse })
      });
      const data = await readJsonResponse(res, 'Error loading lesson. Please try again.');
      setLessonContent(data.message?.trim() || EMPTY_LESSON_MESSAGE);
    } catch (err) {
      console.error(err);
      setLessonContent(err.message || 'Error loading lesson. Please try again.');
    } finally {
      setIsLoadingLesson(false);
    }
  };

  const explainSimpler = async () => {
    if (!selectedTopic) return;
    setIsQuizMode(false);
    setIsLoadingLesson(true);
    try {
      const res = await fetch('/explain-simpler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: selectedTopic.id, difficulty: 'beginner' })
      });
      const data = await readJsonResponse(res, 'Could not simplify the lesson. Please try again.');
      setLessonContent(data.message?.trim() || EMPTY_LESSON_MESSAGE);
    } catch (err) {
      console.error(err);
      setLessonContent(err.message || 'Could not simplify the lesson. Please try again.');
    } finally {
      setIsLoadingLesson(false);
    }
  };

  const startQuiz = async () => {
    if (!selectedTopic) return;

    setIsLoadingQuiz(true);
    setQuizStatus('');
    setIsQuizMode(false);
    setQuizData([]);
    setUserAnswers({});

    try {
      const res = await fetch('/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: selectedTopic.id, difficulty: 'beginner', user_prompt: '' })
      });
      const data = await readJsonResponse(res, 'Could not load quiz. Please try again.');
      const parsedQuiz = JSON.parse(data.message);
      setQuizData(parsedQuiz);
      setIsQuizMode(true);
    } catch (err) {
      console.error(err);
      setQuizStatus(err.message || 'Could not load quiz. Please try again.');
    } finally {
      setIsLoadingQuiz(false);
    }
  };

  const handleAnswerChange = (questionIndex, answer) => {
    setUserAnswers(prev => ({ ...prev, [questionIndex]: answer }));
  };

  const submitQuiz = async () => {
    if (!selectedTopic || quizData.length === 0) return;

    const score = quizData.reduce((total, question, index) => {
      return total + (userAnswers[index] === question.answer ? 1 : 0);
    }, 0);

    setIsSubmittingQuiz(true);

    try {
      const res = await fetch('/quiz/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: selectedTopic.id, score, total: quizData.length })
      });
      const data = await readJsonResponse(res, 'Could not submit quiz. Please try again.');
      await Promise.all([refreshProgress(), refreshCurriculum()]);
      setQuizStatus(
        data.passed
          ? `Quiz passed! You scored ${score}/${quizData.length} and earned ${data.xp_gained} XP.`
          : `Quiz submitted. You scored ${score}/${quizData.length}. You need ${PASSING_SCORE}/${quizData.length} to complete this topic.`
      );
      setIsQuizMode(false);
    } catch (err) {
      console.error(err);
      setQuizStatus(err.message || 'Could not submit quiz. Please try again.');
    } finally {
      setIsSubmittingQuiz(false);
    }
  };

  const handleFileUpload = (e) => {
    if (!selectedTopic || !e.target.files[0]) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('topic_id', selectedTopic.id);
    formData.append('file', file);

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatus('Uploading PDF...');

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(pct);
        if (pct >= 100) {
          setUploadStatus('Analyzing PDF...');
        }
      }
    });
    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadStatus('Upload successful! You can now generate the custom lesson.');
          setUploadProgress(100);
        } else {
          setUploadStatus('Upload failed: ' + (data.detail || 'Unknown error'));
        }
      } catch {
        setUploadStatus('Upload failed: Could not parse response');
      }
      setIsUploading(false);
    });
    xhr.addEventListener('error', () => {
      setUploadStatus('Upload error: Network failure');
      setIsUploading(false);
    });
    xhr.open('POST', '/upload');
    xhr.send(formData);
    e.target.value = null;
  };

  const handleSendMessage = async (e) => {
    if (e.key === 'Enter' && currentMessage.trim() && selectedTopic) {
      const msg = currentMessage.trim();
      setCurrentMessage('');
      setChatMessages(prev => [...prev, { role: 'user', text: msg }]);
      setIsChatting(true);

      try {
        const res = await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic_id: selectedTopic.id, message: msg })
        });
        const data = await readJsonResponse(res, 'Sorry, I encountered an error.');
        setChatMessages(prev => [...prev, { role: 'tutor', text: data.reply }]);
      } catch (err) {
        setChatMessages(prev => [...prev, { role: 'tutor', text: err.message || 'Sorry, I encountered an error.' }]);
      } finally {
        setIsChatting(false);
      }
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      <header role="banner" className="flex justify-between items-center p-4 bg-white shadow z-10">
        <h1 className="text-2xl font-bold text-indigo-600">Learning Companion</h1>
        <div className="flex space-x-6 items-center">
          <div
            className="bg-yellow-100 text-yellow-800 px-4 py-2 rounded-full font-bold shadow-sm"
            aria-label={`${progress.xp} experience points earned`}
            role="status"
          >
            ⭐ {progress.xp} XP
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav aria-label="Course navigation" className="w-64 bg-white border-r border-gray-200 overflow-y-auto p-4 shrink-0">
          <h2 className="text-lg font-bold mb-4 text-gray-700">Courses</h2>
          {courses.map(course => (
            <div key={course.id} className="mb-4">
              <button
                onClick={() => setCollapsedCourses(prev => ({ ...prev, [course.id]: !prev[course.id] }))}
                aria-expanded={!collapsedCourses[course.id]}
                aria-controls={`course-topics-${course.id}`}
                className="w-full flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className={`text-xs text-gray-400 transition-transform duration-200 ${collapsedCourses[course.id] ? '' : 'rotate-90'}`}>&#9654;</span>
                  <h3 className="font-semibold text-gray-800 uppercase tracking-wide text-sm">{course.name}</h3>
                </div>
                {(() => {
                  const total = course.topics.length;
                  const completed = course.topics.filter(t => t.status === 'completed').length;
                  const pct = total > 0 ? (completed / total) * 100 : 0;
                  const radius = 10;
                  const circumference = 2 * Math.PI * radius;
                  const offset = circumference - (pct / 100) * circumference;
                  return (
                    <svg width="28" height="28" className="shrink-0">
                      <circle cx="14" cy="14" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="3" />
                      <circle cx="14" cy="14" r={radius} fill="none" stroke="#22c55e" strokeWidth="3"
                        strokeDasharray={circumference} strokeDashoffset={offset}
                        strokeLinecap="round" transform="rotate(-90 14 14)"
                        style={{ transition: 'stroke-dashoffset 0.4s ease' }} />
                      <text x="14" y="14" textAnchor="middle" dominantBaseline="central"
                        className="fill-gray-600" style={{ fontSize: '7px', fontWeight: 600 }}>
                        {Math.round(pct)}%
                      </text>
                    </svg>
                  );
                })()}
              </button>
              {!collapsedCourses[course.id] && (
                <ul id={`course-topics-${course.id}`} className="space-y-2 mt-2 ml-4" role="list">
                  {course.topics.map(topic => (
                    <li
                      key={topic.id}
                      role="button"
                      tabIndex={0}
                      aria-current={selectedTopic?.id === topic.id ? 'page' : undefined}
                      aria-label={`${topic.name}${topic.status === 'completed' ? ', completed' : topic.status === 'in-progress' ? ', in progress' : ''}`}
                      onClick={() => handleTopicSelect(topic)}
                      onKeyDown={(e) => e.key === 'Enter' && handleTopicSelect(topic)}
                      className={`cursor-pointer p-2 rounded transition-colors flex items-center justify-between group ${selectedTopic?.id === topic.id ? 'bg-indigo-100 border-l-4 border-indigo-500' : 'hover:bg-indigo-50'}`}
                    >
                      <span className={`text-sm ${selectedTopic?.id === topic.id ? 'text-indigo-800 font-semibold' : 'text-gray-600 group-hover:text-indigo-700'}`}>
                        {topic.name}
                      </span>
                      {topic.status === 'completed' && <span aria-hidden="true" className="text-green-500 text-xs">✅</span>}
                      {topic.status === 'in-progress' && <span aria-hidden="true" className="text-yellow-500 text-xs">⏳</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </nav>

        <main id="main-content" role="main" aria-label="Lesson content" className="flex-1 bg-gray-50 overflow-y-auto p-8 flex flex-col items-center">
          {!selectedTopic ? (
            <div className="max-w-3xl w-full bg-white rounded-xl shadow-sm p-10 text-center border border-gray-100 mt-20">
              <h2 className="text-3xl font-bold text-gray-800 mb-4">Welcome to your Learning Companion</h2>
              <p className="text-gray-600 mb-8">Select a topic from the sidebar to start learning. You can also upload your own notes as PDFs!</p>
            </div>
          ) : !isTopicConfigured ? (
            <div className="max-w-2xl w-full bg-white rounded-xl shadow-sm p-10 border border-gray-100 mt-10">
              <h2 className="text-3xl font-bold text-gray-800 mb-6">Configure Topic: {selectedTopic.name}</h2>
              
              <div className="mb-6">
                <label htmlFor="user-prompt" className="block text-gray-700 font-semibold mb-2">What do you want to learn? (Optional)</label>
                <textarea
                  id="user-prompt"
                  aria-describedby="user-prompt-hint"
                  className="w-full border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  rows="3"
                  placeholder="e.g. 'I want to focus heavily on practical examples rather than theory...'"
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                />
                <p id="user-prompt-hint" className="sr-only">Optionally describe what you want to focus on in this topic</p>
              </div>

              <div className="mb-8 p-6 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 text-center">
                <label className="block text-gray-700 font-semibold mb-4">Upload Reference PDF (Optional)</label>
                <div className="flex flex-col items-center gap-4">
                  <label className={`cursor-pointer ${isUploading ? 'bg-gray-300' : 'bg-indigo-100 hover:bg-indigo-200'} text-indigo-700 px-6 py-2 rounded-lg font-semibold transition-colors shadow-sm flex items-center gap-2`}>
                    <span>📄 Select PDF</span>
                    <input type="file" accept=".pdf" className="hidden" disabled={isUploading} onChange={handleFileUpload} />
                  </label>
                  {isUploading && (
                    <div className="w-full max-w-xs">
                      <div className="w-full bg-gray-200 rounded-full h-3">
                        <div
                          className="bg-green-500 h-3 rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${uploadProgress}%` }}
                        ></div>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 text-center">{uploadProgress}%</p>
                    </div>
                  )}
                  {uploadStatus && (
                    <span className={`text-sm font-medium ${uploadStatus.includes('successful') ? 'text-green-600' : uploadStatus.includes('failed') || uploadStatus.includes('error') ? 'text-red-600' : 'text-blue-600'}`}>
                      {uploadStatus}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-4 mt-8 pt-6 border-t border-gray-100">
                <button
                  onClick={() => loadLesson(selectedTopic, userPrompt)}
                  disabled={isUploading}
                  aria-disabled={isUploading}
                  className="flex-1 bg-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors shadow-md disabled:opacity-50"
                >
                  Generate Custom Lesson
                </button>
                <button
                  onClick={() => loadLesson(selectedTopic, "")}
                  disabled={isUploading}
                  aria-disabled={isUploading}
                  className="bg-gray-200 text-gray-800 px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-colors disabled:opacity-50"
                >
                  Skip &amp; Start Default
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl w-full flex flex-col gap-6 mb-10">
              <div className="flex justify-between items-end">
                <h2 className="text-3xl font-bold text-gray-800">{selectedTopic.name}</h2>
                <div className="flex gap-3">
                  <button onClick={explainSimpler} className="bg-indigo-100 text-indigo-700 px-4 py-2 rounded-lg font-semibold hover:bg-indigo-200 transition-colors shadow-sm">
                    🧒 Explain Like I'm 5
                  </button>
                  <button
                    onClick={startQuiz}
                    disabled={isLoadingQuiz || isSubmittingQuiz}
                    className="bg-emerald-100 text-emerald-700 px-4 py-2 rounded-lg font-semibold hover:bg-emerald-200 transition-colors shadow-sm disabled:opacity-50"
                  >
                    {isLoadingQuiz ? 'Loading Quiz...' : 'Take Quiz'}
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm p-8 border border-gray-100 min-h-[400px]">
                {isLoadingLesson || isLoadingQuiz ? (
                  <div role="status" aria-live="polite" aria-label={isLoadingQuiz ? 'Generating quiz' : 'Generating lesson'} className="flex flex-col items-center justify-center h-64 text-gray-500">
                    <div aria-hidden="true" className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                    {isLoadingQuiz ? 'Generating your quiz using Gemini...' : 'Generating your lesson using Gemini...'}
                  </div>
                ) : isQuizMode ? (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-2xl font-bold text-gray-800">Quiz Time</h3>
                      <p className="text-sm text-gray-500 mt-1">Score at least {PASSING_SCORE}/{quizData.length || 5} to complete this topic.</p>
                    </div>
                    {quizData.map((item, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg p-5">
                        <p className="font-semibold text-gray-800 mb-4">{index + 1}. {item.question}</p>
                        <div className="space-y-3">
                          {item.options.map((option) => (
                            <label key={option} className="flex items-center gap-3 text-gray-700 cursor-pointer">
                              <input
                                type="radio"
                                name={`question-${index}`}
                                value={option}
                                checked={userAnswers[index] === option}
                                onChange={() => handleAnswerChange(index, option)}
                              />
                              <span>{option}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={submitQuiz}
                      disabled={isSubmittingQuiz}
                      className="bg-emerald-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-emerald-700 transition-colors shadow-md disabled:opacity-50"
                    >
                      {isSubmittingQuiz ? 'Submitting Quiz...' : 'Submit Quiz'}
                    </button>
                  </div>
                ) : (
                  <div className="prose prose-indigo max-w-none text-gray-700">
                    <ReactMarkdown>{lessonContent}</ReactMarkdown>
                  </div>
                )}
              </div>
              {quizStatus && (
                <div className={`rounded-lg border px-4 py-3 text-sm font-medium ${quizStatus.includes('passed') ? 'border-green-200 bg-green-50 text-green-700' : quizStatus.includes('need') || quizStatus.includes('Could not') ? 'border-yellow-200 bg-yellow-50 text-yellow-800' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>
                  {quizStatus}
                </div>
              )}
            </div>
          )}
        </main>

        <aside aria-label="Tutor chat" className="w-80 bg-white border-l border-gray-200 flex flex-col shadow-inner shrink-0">
          <div className="p-4 border-b border-gray-100 bg-indigo-50">
            <h2 className="text-lg font-bold text-indigo-900 flex items-center">
              <span aria-hidden="true" className="mr-2">💬</span> Tutor Chat
            </h2>
          </div>

          <div
            role="log"
            aria-live="polite"
            aria-label="Chat messages"
            className="flex-1 overflow-y-auto p-4 flex flex-col gap-4"
          >
            {!selectedTopic ? (
              <p className="text-sm text-gray-500 text-center mt-4 italic">Select a topic to start chatting with your AI tutor.</p>
            ) : chatMessages.length === 0 ? (
              <p className="text-sm text-gray-500 text-center mt-4">Hi! Ask me any questions about {selectedTopic.name}.</p>
            ) : (
              chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  role="article"
                  aria-label={msg.role === 'user' ? 'Your message' : 'Tutor reply'}
                  className={`max-w-[85%] p-3 rounded-lg text-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white self-end rounded-tr-none' : 'bg-gray-100 text-gray-800 self-start rounded-tl-none prose prose-sm prose-indigo'}`}
                >
                  {msg.role === 'tutor' ? <ReactMarkdown>{msg.text}</ReactMarkdown> : msg.text}
                </div>
              ))
            )}
            {isChatting && (
              <div role="status" aria-label="Tutor is typing" className="bg-gray-100 text-gray-800 self-start p-3 rounded-lg rounded-tl-none max-w-[85%] text-sm flex gap-1 items-center">
                <div aria-hidden="true" className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div aria-hidden="true" className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                <div aria-hidden="true" className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="p-4 border-t border-gray-200 bg-gray-50">
            <label htmlFor="chat-input" className="sr-only">Ask your tutor a question</label>
            <input
              id="chat-input"
              type="text"
              placeholder={selectedTopic ? "Ask a question and press Enter..." : "Select a topic first"}
              disabled={!selectedTopic || isChatting}
              aria-disabled={!selectedTopic || isChatting}
              value={currentMessage}
              onChange={(e) => setCurrentMessage(e.target.value)}
              onKeyDown={handleSendMessage}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow disabled:bg-gray-100 disabled:cursor-not-allowed text-sm"
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
