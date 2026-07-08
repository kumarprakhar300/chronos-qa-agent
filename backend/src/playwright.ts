import { chromium, Browser, BrowserContext, Page } from 'playwright';

export interface AutomationAction {
  type: 'navigate' | 'click' | 'type' | 'wait' | 'screenshot' | 'scroll';
  target?: string; // CSS selector or dynamic descriptor
  text?: string;   // For typing or verification
  value?: number;  // For wait time or scrolling
}

export class PlaywrightController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async init(headed: boolean = true, viewport: string = 'desktop') {
    if (this.browser) {
      await this.close();
    }
    
    // Force headless mode in production (cloud hosts like Render don't have visual screens/XServer)
    const isProduction = process.env.NODE_ENV === 'production';
    const runHeaded = isProduction ? false : headed;

    // Launch Playwright Chromium
    this.browser = await chromium.launch({
      headless: !runHeaded,
      args: ['--disable-web-security', '--no-sandbox']
    });
    
    // Define viewport settings based on chosen device
    let width = 1280;
    let height = 800;
    let isMobile = false;
    let hasTouch = false;

    if (viewport === 'tablet') {
      width = 768;
      height = 1024;
    } else if (viewport === 'mobile') {
      width = 390;
      height = 844;
      isMobile = true;
      hasTouch = true;
    }

    this.context = await this.browser.newContext({
      viewport: { width, height },
      isMobile,
      hasTouch,
      userAgent: isMobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
        : undefined,
      deviceScaleFactor: 1,
    });
    
    this.page = await this.context.newPage();
  }

  getPage(): Page {
    if (!this.page) {
      throw new Error('Playwright not initialized. Call init() first.');
    }
    return this.page;
  }

  async close() {
    try {
      if (this.page) await this.page.close();
      if (this.context) await this.context.close();
      if (this.browser) await this.browser.close();
    } catch (err) {
      console.error('Error closing Playwright instances:', err);
    } finally {
      this.page = null;
      this.context = null;
      this.browser = null;
    }
  }

  async takeScreenshot(): Promise<string> {
    const page = this.getPage();
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    return buffer.toString('base64');
  }

  async getDOMSnapshot(): Promise<string> {
    const page = this.getPage();
    // Get simple layout snapshot for LLM context (reduces token load)
    return await page.evaluate(() => {
      const getElementDetails = (el: Element): any => {
        const rect = el.getBoundingClientRect();
        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className || undefined,
          text: el.textContent?.trim().slice(0, 50) || undefined,
          role: el.getAttribute('role') || undefined,
          ariaLabel: el.getAttribute('aria-label') || undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          box: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
        };
      };

      // Select interactive elements
      const selectors = 'button, a, input, select, textarea, [role="button"], [onclick]';
      const elements = Array.from(document.querySelectorAll(selectors));
      
      return elements
        .map(el => getElementDetails(el))
        .filter(details => details.box.width > 0 && details.box.height > 0)
        .slice(0, 150); // limit to 150 items to fit prompt limits
    }).then(elements => JSON.stringify(elements, null, 2));
  }

  async execute(action: AutomationAction, healedSelector?: string): Promise<string> {
    const page = this.getPage();
    const selector = healedSelector || action.target;

    switch (action.type) {
      case 'navigate':
        if (!action.text) throw new Error('Navigation action requires a URL in "text" field.');
        await page.goto(action.text, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return `Navigated to ${action.text}`;

      case 'click':
        if (!selector) throw new Error('Click action requires a selector.');
        await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
        await page.click(selector);
        return `Clicked element: ${selector}`;

      case 'type':
        if (!selector || action.text === undefined) {
          throw new Error('Type action requires both selector and text.');
        }
        await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
        await page.fill(selector, action.text);
        return `Typed "${action.text}" into ${selector}`;

      case 'wait':
        const delay = action.value || 2000;
        await page.waitForTimeout(delay);
        return `Waited for ${delay}ms`;

      case 'scroll':
        const distance = action.value || 300;
        await page.evaluate((dist) => window.scrollBy(0, dist), distance);
        return `Scrolled page by ${distance}px`;

      case 'screenshot':
        return 'Screenshot taken';

      default:
        throw new Error(`Unknown action type: ${(action as any).type}`);
    }
  }
}
