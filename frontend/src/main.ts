import './style.css';

// DOM Selectors
const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const geminiKeyInput = document.getElementById('gemini-key') as HTMLInputElement;
const headedBrowserCheck = document.getElementById('headed-browser') as HTMLInputElement;
const instructionsContainer = document.getElementById('instructions-container') as HTMLDivElement;
const newStepTextInput = document.getElementById('new-step-text') as HTMLInputElement;
const addStepBtn = document.getElementById('add-step') as HTMLButtonElement;
const clearStepsBtn = document.getElementById('clear-steps') as HTMLButtonElement;
const runAgentBtn = document.getElementById('run-agent') as HTMLButtonElement;
const statStatus = document.getElementById('stat-status') as HTMLSpanElement;
const statProgress = document.getElementById('stat-progress') as HTMLSpanElement;
const statHeals = document.getElementById('stat-heals') as HTMLSpanElement;
const currentUrlText = document.getElementById('current-url') as HTMLSpanElement;
const screenshotOverlay = document.getElementById('screenshot-overlay') as HTMLDivElement;
const browserScreenshot = document.getElementById('browser-screenshot') as HTMLImageElement;
const terminalLogs = document.getElementById('terminal-logs') as HTMLDivElement;
const clearLogsBtn = document.getElementById('clear-logs') as HTMLButtonElement;
const healingAlertBox = document.getElementById('healing-alert-box') as HTMLDivElement;
const healingAlertDesc = document.getElementById('healing-alert-desc') as HTMLParagraphElement;

// State Variables
let ws: WebSocket | null = null;
let instructions: string[] = [
  'Go to https://google.com',
  'Type "Google Gemini 1.5" in the search box',
  'Click the first search result'
];
let runningStepIndex = -1;
let selfHealCount = 0;
let isRunning = false;

// 1. Initialize WebSocket Connection
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  
  // If running locally in Vite dev mode (port 5173), point to backend port 3001
  // Otherwise, in production, connect to the exact same host/port serving the page
  const host = window.location.port === '5173' 
    ? `${window.location.hostname}:3001` 
    : window.location.host;

  const wsUrl = `${protocol}//${host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    statusDot.className = 'status-dot connected';
    statusText.innerText = 'Connected';
    updateRunButtonState();
  };

  ws.onclose = () => {
    statusDot.className = 'status-dot disconnected';
    statusText.innerText = 'Disconnected - Retrying...';
    updateRunButtonState();
    // Try to reconnect in 3s
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.error('WebSocket connection error:', err);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWSMessage(data);
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  };
}

// 2. Load cached API key on start
function initApiKey() {
  const cachedKey = localStorage.getItem('CHRONOS_GEMINI_KEY');
  if (cachedKey) {
    geminiKeyInput.value = cachedKey;
  }

  geminiKeyInput.addEventListener('input', () => {
    localStorage.setItem('CHRONOS_GEMINI_KEY', geminiKeyInput.value.trim());
    updateRunButtonState();
  });
}

// 3. Render Steps
function renderInstructions() {
  instructionsContainer.innerHTML = '';
  
  if (instructions.length === 0) {
    instructionsContainer.innerHTML = `
      <div class="input-hint" style="text-align: center; padding: 1rem 0;">
        No steps added yet. Write one below!
      </div>
    `;
    return;
  }

  instructions.forEach((step, idx) => {
    const item = document.createElement('div');
    item.className = 'instruction-item';
    if (isRunning && idx === runningStepIndex) {
      item.classList.add('running');
    }
    
    item.innerHTML = `
      <span>${idx + 1}. ${step}</span>
      <button class="remove-step-btn" data-index="${idx}" ${isRunning ? 'disabled' : ''}>&times;</button>
    `;
    
    instructionsContainer.appendChild(item);
  });

  // Attach delete handlers
  const removeButtons = instructionsContainer.querySelectorAll('.remove-step-btn');
  removeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLButtonElement;
      const index = parseInt(target.getAttribute('data-index') || '0', 10);
      instructions.splice(index, 1);
      renderInstructions();
      updateRunButtonState();
    });
  });
  
  updateProgressStat();
}

function updateProgressStat() {
  if (isRunning) {
    statProgress.innerText = `${runningStepIndex + 1} / ${instructions.length}`;
  } else {
    statProgress.innerText = `0 / ${instructions.length}`;
  }
}

function updateRunButtonState() {
  const hasKey = geminiKeyInput.value.trim().length > 0;
  const isConnected = ws && ws.readyState === WebSocket.OPEN;
  const hasSteps = instructions.length > 0;
  
  runAgentBtn.disabled = !hasKey || !isConnected || hasSteps === false || isRunning;
}

// 4. Adding Steps
function addStep(text: string) {
  const stepText = text.trim();
  if (stepText) {
    instructions.push(stepText);
    renderInstructions();
    newStepTextInput.value = '';
    updateRunButtonState();
  }
}

addStepBtn.addEventListener('click', () => addStep(newStepTextInput.value));
newStepTextInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addStep(newStepTextInput.value);
  }
});

clearStepsBtn.addEventListener('click', () => {
  if (isRunning) return;
  instructions = [];
  renderInstructions();
  updateRunButtonState();
});

// Preset event delegation
document.querySelectorAll('.preset-tag').forEach(tag => {
  tag.addEventListener('click', (e) => {
    if (isRunning) return;
    const target = e.currentTarget as HTMLElement;
    const action = target.getAttribute('data-action') || '';
    addStep(action);
  });
});

// Logs utility
function addLogLine(text: string, type: 'system' | 'success' | 'failed' | 'healing' | 'thought' = 'system') {
  const line = document.createElement('div');
  line.className = `terminal-line ${type}-line`;
  
  if (type === 'thought') {
    line.innerText = `↳ VLM Thought: ${text}`;
  } else {
    const timestamp = new Date().toLocaleTimeString();
    line.innerText = `[${timestamp}] ${text}`;
  }

  terminalLogs.appendChild(line);
  terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

clearLogsBtn.addEventListener('click', () => {
  terminalLogs.innerHTML = '';
  addLogLine('Terminal logs cleared.', 'system');
});

// 5. Run Agent Flow
runAgentBtn.addEventListener('click', () => {
  if (isRunning || !ws || ws.readyState !== WebSocket.OPEN) return;

  const key = geminiKeyInput.value.trim();
  const headed = headedBrowserCheck.checked;

  isRunning = true;
  selfHealCount = 0;
  runningStepIndex = 0;
  statHeals.innerText = '0';
  statStatus.innerText = 'Initializing...';
  
  updateRunButtonState();
  renderInstructions();
  
  // Clear screenshot and show placeholder
  browserScreenshot.classList.add('hidden');
  screenshotOverlay.classList.remove('fade-out');
  currentUrlText.innerText = 'Launching browser...';
  
  terminalLogs.innerHTML = '';
  addLogLine('Initiating Chronos visual QA script...', 'system');

  ws.send(JSON.stringify({
    type: 'START_RUN',
    payload: {
      instructions,
      apiKey: key,
      headed
    }
  }));
});

// 6. Handle WebSocket messages from backend
function handleWSMessage(message: any) {
  const { type, payload } = message;

  switch (type) {
    case 'RUN_STARTED':
      statStatus.innerText = 'Running';
      addLogLine('Browser instance started. Processing steps...', 'system');
      break;

    case 'LOG':
      const { step, status, message: logMsg, thought, healedFrom, screenshot } = payload;
      
      // Update running step index based on name
      const stepIdx = instructions.indexOf(step);
      if (stepIdx !== -1 && stepIdx !== runningStepIndex) {
        runningStepIndex = stepIdx;
        renderInstructions();
      }

      // Add main log text
      if (status === 'failed') {
        addLogLine(`${step}: ${logMsg}`, 'failed');
        statStatus.innerText = 'Failed';
      } else if (status === 'success') {
        addLogLine(`${step}: ${logMsg}`, 'success');
      } else if (status === 'healing') {
        addLogLine(`${step}: ${logMsg}`, 'healing');
        triggerHealingAlert(logMsg, healedFrom);
      } else {
        addLogLine(`${step}: ${logMsg}`, 'system');
      }

      // Add thought if present
      if (thought) {
        addLogLine(thought, 'thought');
      }

      // Display Screenshot
      if (screenshot) {
        screenshotOverlay.classList.add('fade-out');
        browserScreenshot.src = `data:image/png;base64,${screenshot}`;
        browserScreenshot.classList.remove('hidden');
      }
      
      // Extract URL from log message if possible (e.g. Navigated to X)
      if (logMsg && logMsg.startsWith('Navigated to ')) {
        const url = logMsg.replace('Navigated to ', '');
        currentUrlText.innerText = url;
      }
      
      updateProgressStat();
      break;

    case 'RUN_COMPLETED':
      isRunning = false;
      runningStepIndex = -1;
      statStatus.innerText = 'Idle';
      addLogLine('Task execution finished.', 'success');
      updateRunButtonState();
      renderInstructions();
      break;

    case 'ERROR':
      isRunning = false;
      runningStepIndex = -1;
      statStatus.innerText = 'Error';
      addLogLine(`Error: ${payload}`, 'failed');
      updateRunButtonState();
      renderInstructions();
      break;
  }
}

// Self Healing Banner trigger
function triggerHealingAlert(message: string, originSelector?: string) {
  selfHealCount++;
  statHeals.innerText = selfHealCount.toString();

  const desc = originSelector 
    ? `Failed selector: "${originSelector}". VLM is resolving elements and patching...`
    : message;

  healingAlertDesc.innerText = desc;
  healingAlertBox.classList.remove('hidden');

  // Slide out after 6 seconds
  setTimeout(() => {
    healingAlertBox.classList.add('hidden');
  }, 6000);
}

// On Startup
initApiKey();
renderInstructions();
connectWebSocket();
