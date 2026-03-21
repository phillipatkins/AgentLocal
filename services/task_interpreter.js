function norm(value) {
  return String(value || "").trim();
}

function lower(value) {
  return norm(value).toLowerCase();
}

function randomDigits(n) {
  let out = "";
  for (let i = 0; i < n; i++) out += String(Math.floor(Math.random() * 10));
  return out;
}

function randomLetters(n) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function generatedProfile() {
  const first = "Alex";
  const last = "Stone";
  const username = `bert${randomLetters(4)}${randomDigits(4)}`;
  const password = `Bert!${randomLetters(3)}${randomDigits(4)}Z`;
  const birthDate = "1990-01-01";
  const emailAddress = `${username}@outlook.com`;

  return {
    username,
    email_address: emailAddress,
    password,
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`,
    birth_date: birthDate,
    country_region: "United Kingdom"
  };
}

async function interpretTask(goal) {
  const text = norm(goal);
  const l = lower(text);

  if (l.includes("outlook") && l.includes("email") && (l.includes("create") || l.includes("new") || l.includes("account"))) {
    return {
      intent: "create_account",
      service: "outlook",
      mode: "page_guided_browser",
      target_url: "https://signup.live.com/",
      generated_profile: generatedProfile(),
      success_markers: [
        "verify",
        "verification",
        "prove you're human",
        "phone number",
        "security challenge",
        "add security info"
      ],
      failure_markers: [
        "page not found",
        "404",
        "something went wrong"
      ]
    };
  }

  return {
    intent: "general_browse",
    service: "",
    mode: "page_guided_browser",
    target_url: "",
    generated_profile: generatedProfile(),
    success_markers: [],
    failure_markers: ["page not found", "404", "something went wrong"]
  };
}

module.exports = {
  interpretTask
};
