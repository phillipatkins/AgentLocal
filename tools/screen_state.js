import { captureScreen } from "./screen_capture.js";
import { ocrImage } from "./screen_ocr.js";
import { listWindows, getActiveWindow } from "./desktop_control.js";

export async function getScreenState() {

  const screenshot = await captureScreen();
  const text = await ocrImage(screenshot);
  const windows = await listWindows();
  const active = await getActiveWindow();

  return {
    screenshot,
    windows,
    activeWindow: active,
    visibleText: text
  };
}