const BrowserAgent = require("./browser_agent");
const { randomProfile, classifyFieldName, valueForField, askOllamaForAction } = require("./form_solver");

function detectService(goal) {
  const g = String(goal || "").toLowerCase();
  if (g.includes("gmail") || g.includes("google mail") || g.includes("google account")) return "gmail";
  if (g.includes("outlook") || g.includes("hotmail") || g.includes("microsoft account")) return "outlook";
  return "outlook";
}

function startUrlForService(service) {
  if (service === "gmail") return "https://accounts.google.com/signup";
  return "https://signup.live.com/";
}

class TaskRunner {
  constructor(goal, chat) {
    this.goal = goal;
    this.chat = chat;
    this.profile = randomProfile();
    this.stuckCount = 0;
    this.lastSignature = "";
    this.service = detectService(goal);
  }

  signature(state) {
    return JSON.stringify({
      text: String(state.text || "").slice(0, 400),
      inputs: state.inputs.map(i => [i.type, i.name, i.placeholder, i.aria, i.value]),
      combos: state.comboboxes.map(c => [c.text, c.aria, c.expanded])
    });
  }

  async run() {
    const browser = new BrowserAgent();
    await browser.start();

    await this.chat.sendMessage(
      "Generated account:\n" +
      `service ${this.service}\n` +
      `email ${this.profile.email}\n` +
      `password ${this.profile.password}`
    );

    await browser.goto(startUrlForService(this.service));

    if (this.service === "gmail") {
      return {
        status: "manual_required",
        message: "Opened Google signup page. Complete any required Google-managed steps manually in the browser."
      };
    }

    for (let step = 0; step < 90; step++) {
      const state = await browser.extractForm();
      console.log("[FORM]", state.inputs.length, "inputs", state.comboboxes.length, "comboboxes");

      const lower = String(state.text || "").toLowerCase();

      if (lower.includes("verify") || lower.includes("prove you're human")) {
        return { status: "complete", message: "Reached verification step" };
      }

      const sig = this.signature(state);
      this.stuckCount = sig === this.lastSignature ? this.stuckCount + 1 : 0;
      this.lastSignature = sig;

      let acted = false;

      for (const input of state.inputs) {
        const key = classifyFieldName(input);
        if (!key) continue;

        const wanted = valueForField(input, this.profile);
        const current = String(input.value || "");

        if (!current) {
          console.log("[FILL]", key, wanted);
          await browser.fillInput(input.index, wanted);
          acted = true;
        }
      }

      if (!acted) {
        for (const combo of state.comboboxes) {
          const comboField = {
            label: combo.text,
            name: combo.name,
            placeholder: combo.placeholder,
            aria: combo.aria,
            text: combo.text
          };
          const key = classifyFieldName(comboField);
          if (!key) continue;
          const wanted = valueForField(comboField, this.profile);
          const current = String(combo.text || "").toLowerCase();
          if (!current.includes(String(wanted).toLowerCase())) {
            console.log("[COMBO]", key, wanted);
            await browser.selectCombobox(combo.index, wanted);
            acted = true;
          }
        }
      }

      if (!acted && lower.includes("add some details")) {
        console.log("[DETAILS_PAGE] explicit handler");
        await browser.selectCombobox(0, this.profile.country).catch(() => {});
        await browser.selectCombobox(1, this.profile.birthMonth).catch(() => {});
        await browser.selectCombobox(2, this.profile.birthDay).catch(() => {});

        const yearInput = state.inputs.find(i => {
          const s = `${i.name} ${i.placeholder} ${i.aria} ${i.label}`.toLowerCase();
          return s.includes("year") || s.includes("birthyear") || i.type === "number";
        });

        if (yearInput && !yearInput.value) {
          await browser.fillInput(yearInput.index, this.profile.birthYear);
        }
        acted = true;
      }

      if (!acted && this.stuckCount >= 2) {
        console.log("[OLLAMA] asking for next action");
        const action = await askOllamaForAction(state, this.profile);

        if (action.action === "fill") {
          await browser.fillInput(action.index, action.value);
          acted = true;
        } else if (action.action === "select") {
          await browser.selectCombobox(action.index, action.value);
          acted = true;
        } else if (action.action === "done") {
          return { status: "complete", message: "Ollama marked task done" };
        }
      }

      await browser.clickNext();
      await browser.page.waitForTimeout(1200);
    }

    return { status: "failed", message: "step limit reached" };
  }
}

module.exports = TaskRunner;
