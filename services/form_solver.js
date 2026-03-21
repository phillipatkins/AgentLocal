const { askOllama, extractJson } = require("./ollama_client");

function rand(n) {
  return Math.floor(Math.random() * n);
}

function randomEmailLocal() {
  return "bert" + String(rand(1000000)).padStart(6, "0");
}

function randomEmail() {
  return `${randomEmailLocal()}@outlook.com`;
}

function randomPassword() {
  return "Bert!" + rand(100000) + "Z";
}

function randomProfile() {
  return {
    email: randomEmail(),
    password: randomPassword(),
    firstName: "Alex",
    lastName: "Stone",
    country: "United Kingdom",
    birthMonth: "January",
    birthDay: "1",
    birthYear: "1990"
  };
}

function classifyFieldName(field) {
  const raw = `${field.label || ""} ${field.name || ""} ${field.placeholder || ""} ${field.aria || ""} ${field.text || ""}`.toLowerCase();

  if (raw.includes("email")) return "email";
  if (raw.includes("password")) return "password";
  if (raw.includes("first")) return "firstName";
  if (raw.includes("last")) return "lastName";
  if (raw.includes("country")) return "country";
  if (raw.includes("region")) return "country";
  if (raw.includes("month")) return "birthMonth";
  if (raw.includes("day")) return "birthDay";
  if (raw.includes("year")) return "birthYear";
  if (raw.includes("birth")) return "birthYear";
  return null;
}

function valueForField(field, profile) {
  const key = classifyFieldName(field);
  if (key && profile[key] != null) return profile[key];
  return "test" + rand(9999);
}

async function askOllamaForAction(state, profile) {
  const prompt = `
You are helping a browser agent complete a signup form.

PAGE TEXT:
${state.text}

INPUTS:
${JSON.stringify(state.inputs, null, 2)}

COMBOBOXES:
${JSON.stringify(state.comboboxes, null, 2)}

PROFILE:
${JSON.stringify(profile, null, 2)}

Return STRICT JSON:
{
  "action":"fill|select|click_next|done",
  "index":0,
  "value":"..."
}

Rules:
- If month/day/country are visible as comboboxes, use action=select.
- If a field is already filled or a combobox already has the wanted value, do not touch it again.
- Prefer using the supplied profile values.
`;
  const raw = await askOllama(prompt);
  return extractJson(raw) || { action: "click_next" };
}

module.exports = {
  randomProfile,
  classifyFieldName,
  valueForField,
  askOllamaForAction
};
