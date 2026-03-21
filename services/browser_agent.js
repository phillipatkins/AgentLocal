const { chromium } = require("playwright");

class BrowserAgent {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async start() {
    console.log("[BROWSER] launching chromium");
    this.browser = await chromium.launch({
      headless: false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(15000);
  }

  async goto(url) {
    console.log("[BROWSER] goto", url);
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await this.page.waitForTimeout(1000);
  }

  async clickNext() {
    const labels = ["Next", "Continue", "Submit", "Create account", "Sign up"];
    for (const label of labels) {
      const locators = [
        this.page.getByRole("button", { name: label, exact: true }),
        this.page.getByText(label, { exact: true })
      ];
      for (const loc of locators) {
        const count = await loc.count().catch(() => 0);
        if (!count) continue;
        try {
          await loc.first().click({ timeout: 2500 });
          await this.page.waitForTimeout(800);
          return true;
        } catch (_) {}
      }
    }
    await this.page.keyboard.press("Enter").catch(() => {});
    await this.page.waitForTimeout(800);
    return true;
  }

  async extractForm() {
    return await this.page.evaluate(() => {
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };

      const text = (document.body?.innerText || "").slice(0, 9000);

      const inputs = [...document.querySelectorAll("input,textarea")]
        .filter(visible)
        .map((el, i) => ({
          index: i,
          tag: el.tagName.toLowerCase(),
          type: (el.getAttribute("type") || "text").toLowerCase(),
          name: el.getAttribute("name") || "",
          placeholder: el.getAttribute("placeholder") || "",
          aria: el.getAttribute("aria-label") || "",
          label: el.labels?.[0]?.innerText || "",
          value: "value" in el ? String(el.value || "") : ""
        }));

      const comboboxSelector = [
        '[role="combobox"]',
        'button[aria-haspopup="listbox"]',
        'div[role="button"][aria-haspopup="listbox"]',
        'button',
        'div[role="button"]'
      ].join(",");

      const rawCombos = [...document.querySelectorAll(comboboxSelector)]
        .filter(visible)
        .map((el) => ({
          text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(),
          aria: el.getAttribute("aria-label") || "",
          name: el.getAttribute("name") || "",
          placeholder: el.getAttribute("placeholder") || "",
          expanded: el.getAttribute("aria-expanded") || "",
          role: el.getAttribute("role") || "",
          tag: el.tagName.toLowerCase()
        }))
        .filter((x) => {
          const s = `${x.text} ${x.aria} ${x.name} ${x.placeholder}`.toLowerCase();
          return (
            s.includes("country") ||
            s.includes("region") ||
            s.includes("month") ||
            s.includes("day") ||
            s.includes("year") ||
            s === "month" ||
            s === "day" ||
            s === "country/region" ||
            s === "country region" ||
            s.includes("united kingdom")
          );
        });

      const comboboxes = rawCombos.map((x, i) => ({ index: i, ...x }));

      return { text, inputs, comboboxes };
    });
  }

  async fillInput(index, value) {
    console.log("[FILL_INPUT]", index, value);
    const loc = this.page.locator("input,textarea").nth(index);
    await loc.click({ force: true }).catch(() => {});
    await loc.fill("").catch(() => {});
    await loc.fill(String(value)).catch(() => {});
    await this.page.waitForTimeout(300);
    return true;
  }

  async selectCombobox(index, wantedValue) {
    console.log("[SELECT_COMBO]", index, wantedValue);

    const selector = [
      '[role="combobox"]',
      'button[aria-haspopup="listbox"]',
      'div[role="button"][aria-haspopup="listbox"]',
      'button',
      'div[role="button"]'
    ].join(",");

    const combos = this.page.locator(selector);
    const total = await combos.count().catch(() => 0);
    if (!total) return false;

    const candidates = [];
    for (let i = 0; i < total; i++) {
      const item = combos.nth(i);
      const text = await item.innerText().catch(() => "");
      const aria = await item.getAttribute("aria-label").catch(() => "");
      const s = `${text} ${aria}`.toLowerCase();
      if (
        s.includes("country") ||
        s.includes("region") ||
        s.includes("month") ||
        s.includes("day") ||
        s.includes("year") ||
        s.includes("united kingdom") ||
        s.trim() === "month" ||
        s.trim() === "day"
      ) {
        candidates.push(item);
      }
    }

    const item = candidates[index];
    if (!item) return false;

    const before = (await item.innerText().catch(() => "")).toLowerCase();
    if (before.includes(String(wantedValue).toLowerCase())) {
      console.log("[SELECT_COMBO] already set");
      return true;
    }

    await item.click({ force: true }).catch(() => {});
    await this.page.waitForTimeout(400);

    const optionLocators = [
      this.page.getByRole("option", { name: wantedValue, exact: true }),
      this.page.getByText(wantedValue, { exact: true }),
      this.page.getByRole("option", { name: wantedValue, exact: false }),
      this.page.getByText(wantedValue, { exact: false })
    ];

    for (const loc of optionLocators) {
      const count = await loc.count().catch(() => 0);
      if (!count) continue;
      try {
        await loc.first().click({ timeout: 2500 });
        await this.page.waitForTimeout(500);
        return true;
      } catch (_) {}
    }

    await this.page.keyboard.press("Escape").catch(() => {});
    return false;
  }
}

module.exports = BrowserAgent;
