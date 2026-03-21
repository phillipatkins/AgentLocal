import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { screenshotCmd } = require("../utils/platform");
const run = promisify(exec);

export async function captureScreen() {
  const file = path.join(os.tmpdir(), `screen_${Date.now()}.png`);
  await run(screenshotCmd(file), { shell: true });
  return file;
}