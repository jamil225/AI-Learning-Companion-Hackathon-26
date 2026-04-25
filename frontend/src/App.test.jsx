import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const initialSubjects = {
  courses: [
    {
      id: 'cs',
      name: 'Computer Science',
      topics: [
        { id: 'cs_1', name: 'Variables & Types', status: 'not-started' },
      ],
    },
  ],
};

const completedSubjects = {
  courses: [
    {
      id: 'cs',
      name: 'Computer Science',
      topics: [
        { id: 'cs_1', name: 'Variables & Types', status: 'completed' },
      ],
    },
  ],
};

const initialProgress = { xp: 15, completed_count: 3, topics: {} };
const completedProgress = {
  xp: 55,
  completed_count: 4,
  topics: {
    cs_1: { score: 4, total: 5, passed: true },
  },
};

const quizPayload = JSON.stringify([
  { question: 'Q1', options: ['A', 'B'], answer: 'A' },
  { question: 'Q2', options: ['A', 'B'], answer: 'A' },
  { question: 'Q3', options: ['A', 'B'], answer: 'A' },
  { question: 'Q4', options: ['A', 'B'], answer: 'A' },
  { question: 'Q5', options: ['A', 'B'], answer: 'B' },
]);

function jsonResponse(body, ok = true) {
  return Promise.resolve({
    ok,
    json: async () => body,
  });
}

function createMockXHR() {
  const uploadListeners = {};
  const listeners = {};

  return class MockXHR {
    constructor() {
      this.status = 200;
      this.responseText = JSON.stringify({ message: 'ok' });
      this.upload = {
        addEventListener: (event, callback) => {
          uploadListeners[event] = callback;
        },
      };
    }

    addEventListener(event, callback) {
      listeners[event] = callback;
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    send() {
      uploadListeners.progress?.({ lengthComputable: true, loaded: 1, total: 1 });
      listeners.load?.();
    }
  };
}

async function selectTopic() {
  const topicItems = await screen.findAllByText('Variables & Types');
  fireEvent.click(topicItems[0]);
}

describe('App', () => {
  beforeEach(() => {
    let subjectsCallCount = 0;
    let progressCallCount = 0;

    global.fetch = vi.fn((url, options = {}) => {
      if (url === 'http://localhost:8081/subjects') {
        subjectsCallCount += 1;
        return jsonResponse(subjectsCallCount > 1 ? completedSubjects : initialSubjects);
      }

      if (url === 'http://localhost:8081/progress') {
        progressCallCount += 1;
        return jsonResponse(progressCallCount > 1 ? completedProgress : initialProgress);
      }

      if (url === 'http://localhost:8081/lesson') {
        const body = JSON.parse(options.body);
        return jsonResponse({
          message: `# Lesson for ${body.topic_id}\nFocus: ${body.user_prompt || 'default'}`,
        });
      }

      if (url === 'http://localhost:8081/explain-simpler') {
        return jsonResponse({ message: 'Simple explanation' });
      }

      if (url === 'http://localhost:8081/quiz') {
        return jsonResponse({ message: quizPayload });
      }

      if (url === 'http://localhost:8081/quiz/evaluate') {
        return jsonResponse({
          message: 'Progress updated successfully',
          passed: true,
          xp_gained: 40,
          new_total_xp: 55,
          completed_count: 4,
        });
      }

      if (url === 'http://localhost:8081/chat') {
        const body = JSON.parse(options.body);
        return jsonResponse({ reply: `Tutor reply to ${body.message}` });
      }

      throw new Error(`Unhandled fetch for ${url}`);
    });

    global.XMLHttpRequest = createMockXHR();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads subjects and progress on startup', async () => {
    render(<App />);

    expect(await screen.findByText('Computer Science')).toBeInTheDocument();
    expect(await screen.findByText('⭐ 15 XP')).toBeInTheDocument();
    expect(screen.getByText('Welcome to your Learning Companion')).toBeInTheDocument();
  });

  it('shows the topic configuration view when a topic is selected', async () => {
    render(<App />);

    await selectTopic();

    expect(
      await screen.findByText('Configure Topic: Variables & Types')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Custom Lesson' })).toBeEnabled();
  });

  it('generates a lesson with the entered prompt', async () => {
    render(<App />);

    await selectTopic();
    fireEvent.change(screen.getByPlaceholderText(/focus heavily on practical examples/i), {
      target: { value: 'practical examples' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Custom Lesson' }));

    expect(await screen.findByText('Lesson for cs_1')).toBeInTheDocument();
    expect(screen.getByText('Focus: practical examples')).toBeInTheDocument();
  });

  it('shows the backend error instead of rendering a blank lesson', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      if (url === 'http://localhost:8081/subjects') {
        return jsonResponse(initialSubjects);
      }

      if (url === 'http://localhost:8081/progress') {
        return jsonResponse(initialProgress);
      }

      if (url === 'http://localhost:8081/lesson') {
        return jsonResponse({ detail: 'Vertex AI auth not configured' }, false);
      }

      throw new Error(`Unhandled fetch for ${url}`);
    });

    render(<App />);

    await selectTopic();
    fireEvent.click(screen.getByRole('button', { name: 'Skip & Start Default' }));

    expect(await screen.findByText('Vertex AI auth not configured')).toBeInTheDocument();
  });

  it('shows a successful PDF upload status', async () => {
    render(<App />);

    await selectTopic();

    const input = screen.getByLabelText('📄 Select PDF');
    const file = new File(['pdf'], 'notes.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByText('Upload successful! You can now generate the custom lesson.')
    ).toBeInTheDocument();
  });

  it('sends a chat message and shows the tutor reply', async () => {
    render(<App />);

    await selectTopic();

    const input = screen.getByPlaceholderText('Ask a question and press Enter...');
    fireEvent.change(input, { target: { value: 'What is a variable?' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });

    expect(await screen.findByText('What is a variable?')).toBeInTheDocument();
    expect(await screen.findByText('Tutor reply to What is a variable?')).toBeInTheDocument();
  });

  it('submits a quiz, refreshes progress, and marks the topic completed', async () => {
    render(<App />);

    await selectTopic();
    fireEvent.click(screen.getByRole('button', { name: 'Skip & Start Default' }));

    expect(await screen.findByText('Lesson for cs_1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Take Quiz' }));

    expect(await screen.findByText('Quiz Time')).toBeInTheDocument();
    const correctOptions = screen.getAllByRole('radio', { name: 'A' });
    correctOptions.slice(0, 3).forEach((radio) => fireEvent.click(radio));
    fireEvent.click(screen.getAllByRole('radio', { name: 'B' })[3]);
    fireEvent.click(screen.getAllByRole('radio', { name: 'B' })[4]);
    fireEvent.click(screen.getByRole('button', { name: 'Submit Quiz' }));

    expect(
      await screen.findByText('Quiz passed! You scored 4/5 and earned 40 XP.')
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('⭐ 55 XP')).toBeInTheDocument();
      expect(screen.getByText('✅')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8081/quiz/evaluate',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
