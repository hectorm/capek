import { rm } from "node:fs/promises";
import process from "node:process";

// Removes the data of the test server once all tests finish
function globalSetup(): () => Promise<void> {
  return async () => {
    if (process.env.PLAYWRIGHT_TMP_DIR) {
      await rm(process.env.PLAYWRIGHT_TMP_DIR, { recursive: true, force: true });
    }
  };
}

export default globalSetup;
