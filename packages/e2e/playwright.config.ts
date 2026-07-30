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
    {
      // DMI-18's third acceptance criterion is "works in Chrome and Firefox at
      // minimum", and a criterion about cross-engine behaviour can only be
      // verified by actually running a second engine.
      //
      // Scoped to that spec on purpose: the DMI-21 signaling spec depends on the
      // Chromium-only launch flags above, and its own AC never asked for Firefox.
      // Widening it here would be scope creep in someone else's ticket — a
      // Firefox WebRTC run belongs to whichever ticket asks for it.
      name: "firefox",
      testMatch: /dmi-18-.*\.spec\.ts$/,
      use: { ...devices["Desktop Firefox"] },
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
      env: {
        // DMI-20's third criterion is that inactive rooms expire on a TTL. The
        // product default is 15 minutes (`DEFAULT_ROOM_TTL_MS`), which no test
        // can wait out, so the clock is shortened here and the spec reads the
        // effective value back from `GET /health` rather than hardcoding it.
        //
        // This parameterises *time*, not the behaviour: the same reaper, on the
        // same code path, frees the same room. What it does not prove is that
        // 15 minutes elapse correctly — that's the platform's timer, not ours.
        ROOM_TTL_MS: "2000",
        ROOM_SWEEP_INTERVAL_MS: "250",
      },
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
