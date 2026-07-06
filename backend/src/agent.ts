import { PlaywrightController, AutomationAction } from './playwright.js';
import dotenv from 'dotenv';

dotenv.config();

export interface AgentStepLog {
  timestamp: string;
  step: string;
  status: 'pending' | 'success' | 'failed' | 'healing';
  message: string;
  thought?: string;
  healedFrom?: string;
  screenshot?: string;
}

export type LogCallback = (log: AgentStepLog) => void;

interface GeminiResponse {
  thought: string;
  action: 'navigate' | 'click' | 'type' | 'wait' | 'scroll' | 'click_coordinates' | 'finish' | 'fail';
  target?: string; // CSS selector
  text?: string;   // Text to type or navigate to
  value?: number;  // Wait time or scroll distance
  x?: number;      // Mouse coordinate
  y?: number;      // Mouse coordinate
  error_report?: string; // Bug description if action is 'fail'
}

export class VisualQAAgent {
  private controller: PlaywrightController;
  private apiKey: string;

  constructor() {
    this.controller = new PlaywrightController();
    this.apiKey = process.env.GEMINI_API_KEY || '';
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  private async callGemini(
    prompt: string,
    screenshotBase64?: string
  ): Promise<GeminiResponse> {
    if (!this.apiKey) {
      throw new Error('Gemini API Key is missing. Please set it in backend/.env or UI config.');
    }

    const model = 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    const parts: any[] = [{ text: prompt }];

    if (screenshotBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: screenshotBase64,
        },
      });
    }

    const payload = {
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.statusText} (${errorText})`);
    }

    const data = (await response.json()) as any;
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!responseText) {
      throw new Error('Empty response from Gemini API');
    }

    try {
      return JSON.parse(responseText.trim()) as GeminiResponse;
    } catch (err) {
      console.error('Failed to parse Gemini response as JSON. Raw response:', responseText);
      throw new Error('VLM response format was invalid.');
    }
  }

  async runTask(
    userInstructions: string[],
    logCallback: LogCallback,
    headed: boolean = true
  ) {
    logCallback({
      timestamp: new Date().toISOString(),
      step: 'Initialization',
      status: 'pending',
      message: 'Launching Playwright browser context...',
    });

    await this.controller.init(headed);
    const page = this.controller.getPage();

    try {
      for (let i = 0; i < userInstructions.length; i++) {
        const instruction = userInstructions[i];
        let attempts = 0;
        const maxAttempts = 3;
        let success = false;
        let currentSelector: string | undefined;

        logCallback({
          timestamp: new Date().toISOString(),
          step: instruction,
          status: 'pending',
          message: `Starting execution of: "${instruction}"`,
        });

        while (attempts < maxAttempts && !success) {
          attempts++;
          
          // 1. Capture current visual state
          const screenshot = await this.controller.takeScreenshot();
          const domSnapshot = await this.controller.getDOMSnapshot();
          const currentUrl = page.url();

          // 2. Ask VLM what to do for this instruction given the screenshot and DOM
          const systemPrompt = `
You are Chronos, a Visual QA Automation Agent.
Your current task step: "${instruction}"
Current URL: ${currentUrl}
Attempt: ${attempts} of ${maxAttempts}

You are provided with:
1. A screenshot of the web browser (visual representation).
2. A DOM snapshot of interactive elements (JSON format with coordinates and properties).

Your goal is to decide the exact browser automation action needed to complete the step.
Choose from one of these action types:
- "navigate": Open a new URL. Provide the URL in the "text" field.
- "click": Click an element. Identify its CSS selector and provide it in the "target" field.
- "click_coordinates": Click on a specific point in the page (useful if no CSS selector matches, e.g., Canvas, maps, image links). Provide "x" and "y" pixel coordinates.
- "type": Fill an input field. Provide CSS selector in "target" and the text value in "text".
- "scroll": Scroll the page. Provide scroll pixel value in "value" (positive for down, negative for up).
- "wait": Pause for a duration. Provide milliseconds in "value" (default 2000).
- "finish": Use this ONLY when the current instruction is fully completed and verified.
- "fail": Use this if you hit a blocking layout issue, a bug, or cannot complete the action. Describe the issue in "error_report".

Output JSON format strictly conforming to this interface:
{
  "thought": "Explain your visual analysis and why you chose this action",
  "action": "navigate" | "click" | "click_coordinates" | "type" | "scroll" | "wait" | "finish" | "fail",
  "target": "CSS Selector string (optional)",
  "text": "text value or URL (optional)",
  "value": number (optional),
  "x": number (optional),
  "y": number (optional),
  "error_report": "Reason for failure (optional)"
}
`;

          try {
            const vlmResponse = await this.callGemini(systemPrompt, screenshot);
            
            logCallback({
              timestamp: new Date().toISOString(),
              step: instruction,
              status: attempts > 1 ? 'healing' : 'pending',
              message: `Agent Thought: ${vlmResponse.thought}`,
              thought: vlmResponse.thought,
              screenshot,
            });

            if (vlmResponse.action === 'finish') {
              success = true;
              logCallback({
                timestamp: new Date().toISOString(),
                step: instruction,
                status: 'success',
                message: `Successfully completed step: "${instruction}"`,
                screenshot,
              });
              break;
            }

            if (vlmResponse.action === 'fail') {
              throw new Error(`VLM marked step as failed: ${vlmResponse.error_report}`);
            }

            // Execute action
            if (vlmResponse.action === 'click_coordinates') {
              if (vlmResponse.x === undefined || vlmResponse.y === undefined) {
                throw new Error('Coordinate click selected but x or y was missing.');
              }
              await page.mouse.click(vlmResponse.x, vlmResponse.y);
              logCallback({
                timestamp: new Date().toISOString(),
                step: instruction,
                status: 'pending',
                message: `Clicked physical coordinates: (${vlmResponse.x}, ${vlmResponse.y})`,
              });
            } else {
              // Standard action execution
              const actionToRun: AutomationAction = {
                type: vlmResponse.action as any,
                target: vlmResponse.target,
                text: vlmResponse.text,
                value: vlmResponse.value,
              };

              // Capture the target selector for healing logging
              if (vlmResponse.target) {
                currentSelector = vlmResponse.target;
              }

              const resultMsg = await this.controller.execute(actionToRun);
              logCallback({
                timestamp: new Date().toISOString(),
                step: instruction,
                status: 'pending',
                message: resultMsg,
              });
            }

            // Quick wait after action for DOM updates
            await page.waitForTimeout(1500);

          } catch (err: any) {
            console.error(`Attempt ${attempts} failed for instruction "${instruction}":`, err.message);
            
            if (attempts >= maxAttempts) {
              throw err;
            }

            logCallback({
              timestamp: new Date().toISOString(),
              step: instruction,
              status: 'healing',
              message: `Attempt ${attempts} failed. Triggering Self-Healing: ${err.message}`,
              healedFrom: currentSelector,
            });
            
            // Cool-down and allow page state to resolve before next attempt
            await page.waitForTimeout(3000);
          }
        }
      }

      logCallback({
        timestamp: new Date().toISOString(),
        step: 'Teardown',
        status: 'success',
        message: 'All instructions completed successfully! Browser closed.',
      });

    } catch (err: any) {
      logCallback({
        timestamp: new Date().toISOString(),
        step: 'Execution Failure',
        status: 'failed',
        message: `Task run terminated: ${err.message}`,
      });
    } finally {
      await this.controller.close();
    }
  }
}
