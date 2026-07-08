import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { VisualQAAgent, AgentStepLog } from './agent';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const agent = new VisualQAAgent();

// HTTP endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', time: new Date().toISOString() });
});

app.post('/api/config', (req, res) => {
  const { apiKey } = req.body;
  if (apiKey) {
    agent.setApiKey(apiKey);
    return res.json({ success: true, message: 'API key updated successfully' });
  }
  return res.status(400).json({ success: false, message: 'apiKey is required' });
});

// WebSocket Server Integration
wss.on('connection', (ws: WebSocket) => {
  console.log('Frontend dashboard client connected to WebSocket.');

  ws.on('message', async (message: string) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'START_RUN') {
        const { instructions, apiKey, headed, viewport } = data.payload;

        if (apiKey) {
          agent.setApiKey(apiKey);
        }

        if (!instructions || !Array.isArray(instructions) || instructions.length === 0) {
          ws.send(JSON.stringify({
            type: 'ERROR',
            payload: 'Instructions list cannot be empty.'
          }));
          return;
        }

        console.log(`Starting Chronos run on ${viewport || 'desktop'} viewport with ${instructions.length} instructions...`);
        
        ws.send(JSON.stringify({
          type: 'RUN_STARTED',
          payload: { instructions }
        }));

        // Execute agent and send logs back in real time
        await agent.runTask(
          instructions,
          (log: AgentStepLog) => {
            ws.send(JSON.stringify({
              type: 'LOG',
              payload: log
            }));
          },
          headed !== false,
          viewport || 'desktop'
        );

        ws.send(JSON.stringify({
          type: 'RUN_COMPLETED'
        }));

      } else if (data.type === 'SET_API_KEY') {
        const { apiKey } = data.payload;
        if (apiKey) {
          agent.setApiKey(apiKey);
          ws.send(JSON.stringify({
            type: 'API_KEY_SET',
            payload: 'API Key configured.'
          }));
        }
      }
    } catch (err: any) {
      console.error('Error handling WebSocket message:', err);
      ws.send(JSON.stringify({
        type: 'ERROR',
        payload: err.message || 'Internal server error during websocket task run.'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Dashboard client disconnected.');
  });
});

// Serve frontend build assets in production
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

server.listen(port, () => {
  console.log(`===============================================`);
  console.log(` Chronos QA Agent Server running on port ${port} `);
  console.log(`===============================================`);
});
