import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "browser.spec.js",
  timeout: 45000,
  expect: { timeout: 6000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4917",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "python3 -m http.server 4917 --bind 127.0.0.1",
    url: "http://127.0.0.1:4917",
    reuseExistingServer: false,
    timeout: 12000
  }
});
