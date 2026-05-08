const fs = require('fs/promises');
const { chromium } = require('playwright'); // npm install playwright

const ui_agent = {
  name: "ui_agent",
  description: "Controls a headless browser to search, click buttons, fill forms on any website. Returns screenshots + extracted data.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Starting URL, e.g. 'https://example.com'" },
      actions: {
        type: "array",
        description: "Steps to execute in order",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["goto", "click", "type", "wait", "select", "screenshot", "extract"] },
            selector: { type: "string", description: "CSS selector, text, or xpath. For 'type': the text to input." },
            value: { type: "string", description: "Value to type/select. For 'wait': ms to wait." },
            name: { type: "string", description: "For 'screenshot' or 'extract': filename or key name" }
          },
          required: ["type"]
        }
      },
      target: { type: "string", default: "local", description: "Where to run: 'local'=AgentOS server. Future: device IP" }
    },
    required: ["url", "actions"]
  },

  run: async ({ url, actions, target = "local" }, { logger }) => {
    if (target!== "local") {
      throw new Error('Remote device control not supported yet. Only target="local" works. AgentOS will run browser on its own server.');
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    const page = await context.newPage();
    const results = { steps: [], screenshots: [], data: {} };
    const timestamp = Date.now();

    try {
      logger.info(`UI_AGENT: Starting at ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      results.steps.push(`Navigated to ${url}`);

      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        logger.info(`UI_AGENT: Step ${i+1}/${actions.length} - ${a.type}`);

        if (a.type === 'goto') {
          await page.goto(a.selector, { waitUntil: 'networkidle', timeout: 30000 });
          results.steps.push(`Goto ${a.selector}`);
        }

        if (a.type === 'click') {
          await page.click(a.selector, { timeout: 10000 });
          results.steps.push(`Clicked ${a.selector}`);
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        }

        if (a.type === 'type') {
          await page.fill(a.selector, a.value, { timeout: 10000 });
          results.steps.push(`Typed into ${a.selector}`);
        }

        if (a.type === 'select') {
          await page.selectOption(a.selector, a.value, { timeout: 10000 });
          results.steps.push(`Selected ${a.value} in ${a.selector}`);
        }

        if (a.type === 'wait') {
          const ms = parseInt(a.value) || 1000;
          await page.waitForTimeout(ms);
          results.steps.push(`Waited ${ms}ms`);
        }

        if (a.type === 'screenshot') {
          const filename = `ui_agent_${timestamp}_${a.name || i}.png`;
          const filepath = `/mnt/data/${filename}`;
          await page.screenshot({ path: filepath, fullPage: false });
          results.screenshots.push(filepath);
          results.steps.push(`Screenshot: ${filename}`);
        }

        if (a.type === 'extract') {
          const key = a.name || `data_${i}`;
          let extracted;
          if (a.selector.startsWith('text:')) {
            extracted = await page.locator(a.selector.slice(5)).innerText();
          } else {
            extracted = await page.locator(a.selector).innerText();
          }
          results.data[key] = extracted.trim();
          results.steps.push(`Extracted ${key}`);
        }
      }

      await browser.close();

      // Save summary
      const summaryPath = `/mnt/data/ui_agent_${timestamp}_summary.json`;
      await fs.writeFile(summaryPath, JSON.stringify(results, null, 2));

      let msg = `🖱️ *UI Agent Complete*\n\n**URL**: ${url}\n**Steps**: ${results.steps.length}\n**Screenshots**: ${results.screenshots.length}\n**Data extracted**: ${Object.keys(results.data).length}\n\n`;
      if (Object.keys(results.data).length > 0) {
        msg += `**Extracted**:\n`;
        for (const [k, v] of Object.entries(results.data)) {
          msg += `- **${k}**: ${v.slice(0, 100)}${v.length > 100? '...' : ''}\n`;
        }
      }

      await fs.appendFile('./knowledge/soul.md',
        `\n## UI Agent Run ${new Date().toISOString()}\nURL: ${url}\nSteps: ${results.steps.length}\nSuccess: true\n`);

      return { success: true, message: msg, results, screenshots: results.screenshots };

    } catch (err) {
      await browser.close().catch(() => {});
      await fs.appendFile('./knowledge/failed-commands.md',
        `\n## ui_agent failed ${new Date().toISOString()}\nURL: ${url}\nError: ${err.message}\nSteps completed: ${results.steps.length}\n`);
      throw new Error(`UI Agent failed at step ${results.steps.length + 1}: ${err.message}\n\nCompleted:\n${results.steps.join('\n')}`);
    }
  }
};

module.exports = { ui_agent };
