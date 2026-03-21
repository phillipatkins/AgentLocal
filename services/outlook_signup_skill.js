function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function makeGeneratedInputs() {
  const first = "Alex";
  const last = "Stone";
  const username = `bert${randomLetters(4)}${randomDigits(4)}`;
  const password = `Bert!${randomLetters(3)}${randomDigits(4)}Z`;
  const birth_date = "1990-01-01";
  const country_region = "United Kingdom";
  return {
    first_name: first,
    last_name: last,
    username,
    password,
    birth_date,
    country_region
  };
}

function suffixUsername(base, attempt) {
  if (attempt <= 0) return base;
  return `${base}${attempt}`;
}

function monthLabel(monthIndex) {
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  return names[Math.max(0, Math.min(11, monthIndex - 1))];
}

function parseBirthDate(raw) {
  const text = String(raw || "").trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return {
    year: m[1],
    month: parseInt(m[2], 10),
    day: String(parseInt(m[3], 10))
  };
}

function hasAny(state, values) {
  const hay = `${state.title}\n${state.url}\n${state.text}`.toLowerCase();
  return values.some((v) => hay.includes(String(v).toLowerCase()));
}

async function ensureOfficialOutlookSignup(browser) {
  await browser.goto("https://signup.live.com/");
  const ok = await browser.waitForAnyText([
    "Create your Microsoft account",
    "Sign in",
    "Email",
    "Get a new email address",
    "Use a phone number instead",
    "Create account"
  ], 15000);
  if (!ok) throw new Error("Official Microsoft signup page did not load");
}

async function switchToNewOutlookAddress(browser) {
  const state = await browser.state();

  if (hasAny(state, ["email address", "sign in", "use your email instead"]) || hasAny(state, ["@gmail.com", "@yahoo.com"])) {
    const clicked = await browser.clickText([
      "Get a new email address",
      "Create one!",
      "Create one"
    ]);

    if (clicked) {
      await browser.waitForAnyText([
        "Create your Microsoft account",
        "@outlook.com",
        "@hotmail.com",
        "Next",
        "Create a password"
      ], 12000).catch(() => {});
    }
  }
}

async function fillUsernameStage(browser, baseUsername) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const username = suffixUsername(baseUsername, attempt);
    const stateBefore = await browser.state();

    const explicitOutlookChoiceVisible = hasAny(stateBefore, ["@outlook.com", "@hotmail.com", "Get a new email address"]);
    const requiresFullEmail = hasAny(stateBefore, [
      "enter a valid email address",
      "email address",
      "use your email instead"
    ]) && !explicitOutlookChoiceVisible;

    const valueToUse = requiresFullEmail ? `${username}@outlook.com` : username;

    const filled = await browser.fillSelector([
      "input[type=email]",
      "input[name=MemberName]",
      "input[name*=user i]",
      "input[aria-label*=email i]",
      "input[placeholder*=email i]",
      "input[type=text]"
    ], valueToUse);

    if (!filled) throw new Error("Could not find the username/email field on the Microsoft signup page");

    const clickedNext = await browser.clickText(["Next"]);
    if (!clickedNext) await browser.pressKey("Enter");
    await sleep(1600);

    const stateAfter = await browser.state();

    if (hasAny(stateAfter, ["someone already has this email address", "this email is taken", "already taken", "not available"])) {
      console.log("[OUTLOOK] username unavailable, trying another");
      continue;
    }

    if (hasAny(stateAfter, ["enter a valid email address"])) {
      console.log("[OUTLOOK] retrying with explicit @outlook.com");
      const retryValue = `${username}@outlook.com`;
      const retryFill = await browser.fillSelector([
        "input[type=email]",
        "input[name=MemberName]",
        "input[type=text]"
      ], retryValue);
      if (!retryFill) throw new Error("Could not retry the email field with full Outlook address");

      const next2 = await browser.clickText(["Next"]);
      if (!next2) await browser.pressKey("Enter");
      await sleep(1600);

      const afterRetry = await browser.state();
      if (hasAny(afterRetry, ["Create a password", "password"])) {
        return { finalUsername: retryValue };
      }
      if (hasAny(afterRetry, ["someone already has this email address", "this email is taken", "already taken", "not available"])) {
        continue;
      }
      throw new Error("Microsoft signup still rejected the Outlook email address");
    }

    if (hasAny(stateAfter, ["Create a password", "password"])) {
      return { finalUsername: requiresFullEmail ? `${username}@outlook.com` : username };
    }
  }

  throw new Error("Could not find an available Outlook username after several attempts");
}

async function fillPasswordStage(browser, password) {
  const filled = await browser.fillSelector([
    "input[type=password]",
    "input[name=Password]",
    "input[aria-label*=password i]"
  ], password);

  if (!filled) throw new Error("Could not find the password field");

  const clickedNext = await browser.clickText(["Next"]);
  if (!clickedNext) await browser.pressKey("Enter");
  await sleep(1600);

  const state = await browser.state();
  if (hasAny(state, ["create a valid password", "password isn't strong enough", "password must"])) {
    throw new Error("Microsoft rejected the password. Use a stronger password.");
  }
}

async function fillNameStage(browser, firstName, lastName) {
  const firstOk = await browser.fillSelector([
    "input[name=FirstName]",
    "input[aria-label*=first name i]",
    "input[placeholder*=first name i]"
  ], firstName);

  const lastOk = await browser.fillSelector([
    "input[name=LastName]",
    "input[aria-label*=last name i]",
    "input[placeholder*=last name i]"
  ], lastName);

  if (!firstOk || !lastOk) throw new Error("Could not find the first name and last name fields");

  const clickedNext = await browser.clickText(["Next"]);
  if (!clickedNext) await browser.pressKey("Enter");
  await sleep(1600);
}

async function fillBirthStage(browser, birthDateRaw, countryRegion) {
  const parsed = parseBirthDate(birthDateRaw);
  if (!parsed) throw new Error("Birth date must be in YYYY-MM-DD format");

  const stateBefore = await browser.state();
  if (!hasAny(stateBefore, ["Country/Region", "Month", "Day", "Year", "birthdate"])) {
    return true;
  }

  await browser.selectOption([
    "select[name=Country]",
    "select[name=CountryRegion]",
    "select[aria-label*=country i]"
  ], countryRegion).catch(() => {});
  await browser.chooseComboboxOption(["Country/Region", "Country"], [countryRegion]).catch(() => {});

  let monthDone = await browser.selectOption([
    "select[name=BirthMonth]",
    "select[aria-label*=month i]"
  ], monthLabel(parsed.month));

  if (!monthDone) {
    monthDone = await browser.chooseComboboxOption(["Month"], [monthLabel(parsed.month), String(parsed.month)]);
  }

  let dayDone = await browser.selectOption([
    "select[name=BirthDay]",
    "select[aria-label*=day i]"
  ], parsed.day);

  if (!dayDone) {
    dayDone = await browser.chooseComboboxOption(["Day"], [parsed.day]);
  }

  const yearDone = await browser.fillSelector([
    "input[name=BirthYear]",
    "input[aria-label*=year i]",
    "input[placeholder*=year i]"
  ], parsed.year);

  if (!monthDone || !dayDone || !yearDone) {
    throw new Error("Could not fully fill the birth date fields");
  }

  const clickedNext = await browser.clickText(["Next"]);
  if (!clickedNext) await browser.pressKey("Enter");
  await sleep(1800);

  const stateAfter = await browser.state();
  if (hasAny(stateAfter, ["enter your birthdate"])) {
    console.log("[OUTLOOK] birthdate validation appeared, retrying month/day selection");
    const monthRetry = await browser.chooseComboboxOption(["Month"], [monthLabel(parsed.month), String(parsed.month)]);
    const dayRetry = await browser.chooseComboboxOption(["Day"], [parsed.day]);
    if (!monthRetry || !dayRetry) {
      throw new Error("Birthdate validation failed and retry could not select month/day");
    }
    const next2 = await browser.clickText(["Next"]);
    if (!next2) await browser.pressKey("Enter");
    await sleep(1800);
  }

  return true;
}

async function runOutlookSignup(browser, inputs, chat) {
  console.log("[OUTLOOK] starting dedicated Outlook signup skill");

  const merged = {
    ...makeGeneratedInputs(),
    ...(inputs || {})
  };

  if (chat) {
    await chat.sendMessage(
      "ℹ️ Generated signup details:\n"
      + `username ${merged.username}\n`
      + `password ${merged.password}\n`
      + `first name ${merged.first_name}\n`
      + `last name ${merged.last_name}\n`
      + `birth date ${merged.birth_date}`
    );
  }

  await ensureOfficialOutlookSignup(browser);
  await switchToNewOutlookAddress(browser);

  const state1 = await browser.state();
  console.log("[OUTLOOK] page after switching:", state1.title, state1.url);

  const usernameResult = await fillUsernameStage(browser, merged.username);
  merged.username = usernameResult.finalUsername;

  if (chat) {
    await chat.sendMessage(`ℹ️ Using Outlook address candidate: ${merged.username}`);
  }

  const state2 = await browser.state();
  if (!hasAny(state2, ["Create a password", "password"])) {
    throw new Error("Did not reach the password step after username entry");
  }

  await fillPasswordStage(browser, merged.password);

  const state3 = await browser.state();
  if (hasAny(state3, ["First name", "Last name", "Add your name"])) {
    await fillNameStage(browser, merged.first_name, merged.last_name);
  }

  const state4 = await browser.state();
  if (hasAny(state4, ["Country/Region", "Month", "Day", "Year", "birthdate"])) {
    await fillBirthStage(browser, merged.birth_date, merged.country_region);
  }

  const finalState = await browser.state();

  if (hasAny(finalState, ["verify", "verification", "prove you're human", "phone number", "security challenge", "let's verify"])) {
    return {
      status: "complete",
      message: `complete | reached verification step | ${finalState.title} | ${finalState.url}`
    };
  }

  if (hasAny(finalState, ["enter your birthdate"])) {
    return {
      status: "failed",
      message: `failed | birthdate step is still incomplete | ${finalState.title} | ${finalState.url}`
    };
  }

  if (hasAny(finalState, ["something went wrong", "page not found", "404"])) {
    return {
      status: "failed",
      message: `failed | Microsoft signup page reported an error | ${finalState.title} | ${finalState.url}`
    };
  }

  return {
    status: "partial",
    message: `partial | advanced through Outlook signup but did not yet reach verification | ${finalState.title} | ${finalState.url}`
  };
}

module.exports = {
  runOutlookSignup,
  makeGeneratedInputs
};
