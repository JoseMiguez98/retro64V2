import { defineConfig, devices } from "@playwright/test";

// E2E verification harness for the loop protocol (AGENTS.md §1.4).
//
// The point of this suite is independent verification: it boots the *real*
// signaling server and the *real* web dev server, then drives them with real
// browsers. Nothing here mocks the thing under test — a passing run means the
// feature actually worked, not that an agent said it did.
//
// Ports are pinned rather than randomised because the signaling server's CORS
// allowlist is `http://localhost:5173` (packages/signaling/src/server.ts), so
// browser pages have to be served from exactly that origin.

const WEB_ORIGIN = "http://localhost:5173";
const SIGNALING_ORIGIN = "http://localhost:3001";

export default defineConfig({
  testDir: "./tests",
  // Signaling pairing state is process-global on the server (FIFO waiting
  // slot), so parallel specs would pair peers across unrelated tests.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // WebRTC in headless Chromium: allow loopback ICE candidates so a
          // DataChannel can complete without a real STUN round-trip.
          args: [
            "--allow-loopback-in-peer-connection",
            "--disable-web-security",
          ],
        },
      },
    },
  ],

  webServer: [
    {
      command: "pnpm --filter @retro64/signaling dev",
      url: `${SIGNALING_ORIGIN}/health`,
      cwd: "../..",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter @retro64/web dev",
      url: WEB_ORIGIN,
      cwd: "../..",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
