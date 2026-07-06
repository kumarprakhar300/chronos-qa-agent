# Chronos: Visual Self-Healing QA & Testing Agent

### 🔗 Live Demo: [https://chronos-qa-agent.onrender.com](https://chronos-qa-agent.onrender.com)

Chronos is an autonomous, Visual-Language Model (VLM) powered E2E testing agent. It reads natural language instructions, runs them inside a programmatically controlled browser (Playwright), captures screenshots, and utilizes the Gemini API to decide actions and automatically heal broken selectors in real-time.

All progress, visual actions, screenshots, and self-healing details are streamed back to a premium dark glassmorphic control panel dashboard.

## 🛠️ Architecture & Concepts

This project demonstrates several advanced AI and systems engineering patterns:

1. **Monorepo Workspace:** Configured with NPM Workspaces to manage `frontend` (Vite) and `backend` (Express) side-by-side.
2. **WebSocket Real-Time Event Stream:** Uses raw WebSockets (`ws`) to stream browser screenshots, element focus, and VLM thoughts to the frontend dashboard.
3. **DOM Layout Downsampling:** Plays safe with token constraints by converting complex HTML DOM into a simplified structural JSON model before sending it to the VLM.
4. **Coordinate Click Mapping:** If standard CSS selectors fail or are absent (such as inside a `<canvas>` or custom web component), the VLM estimates screen-space pixel coordinates `(x, y)` which Playwright triggers directly.
5. **Dynamic Self-Healing Retries:** Intercepts automation timeouts and dynamically triggers a VLM evaluation to resolve new element locations, patch variables, and resume without failing the QA run.

---

## 🚀 Setup & Execution

### Prerequisites
- **Node.js** (v18+ recommended)
- **NPM**
- **Git**
- A **Gemini API Key** (Get one from [Google AI Studio](https://aistudio.google.com/))

### 1. Installation
Clone the repository and install all dependencies:
```bash
# Install root, backend, and frontend dependencies
npm install

# Download Playwright Chromium binaries
npx playwright install chromium --workspace=backend
```

### 2. Configure Environment (Optional)
Create a `.env` file in the `backend/` folder:
```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3001
```
*Note: If you leave this blank, you can also paste your Gemini API Key directly into the Frontend UI config panel.*

### 3. Running the Application
From the root directory, start both the frontend and backend servers concurrently:
```bash
npm run dev
```

- **Frontend Dashboard:** [http://localhost:5173](http://localhost:5173) (Vite server)
- **Backend API Server:** [http://localhost:3001](http://localhost:3001) (Express WebSocket server)

---

## 📈 Code Structure

- `/backend/src/playwright.ts` — Launches chromium, handles actions (click, type, navigate, wait), and takes screenshots/DOM snapshot.
- `/backend/src/agent.ts` — The core self-healing loops and Gemini VLM connection REST client.
- `/backend/src/index.ts` — Sets up Express, initializes WebSockets, and handles the `START_RUN` messages.
- `/frontend/index.html` — The glassmorphic layout and workspace structure.
- `/frontend/src/style.css` — High-fidelity cyber glassmorphic styles with responsive grids and glowing amber alerts.
- `/frontend/src/main.ts` — Listens to user inputs, handles presets, hooks to WebSockets, and renders screenshots and log steps in real-time.
