// Where the suite points. Unset → the local dev servers that playwright.config.ts
// boots; set → an already-running deployment (e.g. a PR preview), which the
// config then leaves alone instead of starting a local copy.

const LOCAL_WEB_URL = "http://localhost:5173";
const LOCAL_SIGNALING_URL = "http://localhost:3001";

const fromEnv = (name: string): string | undefined => {
  const value = process.env[name]?.trim();
  return value ? value.replace(/\/+$/, "") : undefined;
};

const remoteWebUrl = fromEnv("E2E_BASE_URL");
const remoteSignalingUrl = fromEnv("E2E_SIGNALING_URL");

export const WEB_URL = remoteWebUrl ?? LOCAL_WEB_URL;
export const SIGNALING_URL = remoteSignalingUrl ?? LOCAL_SIGNALING_URL;

export const isRemoteWeb = remoteWebUrl !== undefined;
export const isRemoteSignaling = remoteSignalingUrl !== undefined;
