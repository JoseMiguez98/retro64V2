import { PROTOCOL_VERSION, ROOM_CODE_LENGTH } from "@retro64/shared";
import { acceptedExtensions, SUPPORTED_CONSOLES } from "../emulator/consoles";

// Markup for the whole app shell (DMI-25). One document holding all three
// views; `[data-view]` on the root decides which one is on screen, so a
// transition is a state change rather than a page load and the emulator canvas
// survives navigation instead of being torn down and rebuilt.
//
// Every view carries its own way back — that's the "no dead-ends" criterion,
// and it's structural here rather than something each handler has to remember.
// Visual language is design.md's Neo-Retro Pixel (see style.css).

/** Every ROM extension any supported console accepts, for the file picker. */
function romAcceptAttribute(): string {
  const extensions = new Set(
    SUPPORTED_CONSOLES.flatMap((console) => acceptedExtensions(console.id)),
  );
  return [...extensions].join(",");
}

function consoleOptions(): string {
  return SUPPORTED_CONSOLES.map(
    (console) => `<option value="${console.id}">${console.label}</option>`,
  ).join("");
}

export function appShellMarkup(): string {
  return `
  <div class="app" data-view="landing" data-testid="app">
    <header class="topbar">
      <span class="topbar__brand">RETRO64</span>
      <span class="topbar__tag">2-PLAYER NETPLAY</span>
      <span class="topbar__proto">protocol v${PROTOCOL_VERSION}</span>
    </header>

    <main class="views">
      <!-- ── Landing ─────────────────────────────────────────────────── -->
      <section class="view view--landing" id="view-landing" data-testid="view-landing" aria-labelledby="landing-title">
        <div class="hero">
          <h1 class="hero__title" id="landing-title">PLAY RETRO,<br />TOGETHER.</h1>
          <p class="hero__lede">
            Load a ROM from your own machine, open a room, and share the code with a
            friend. Your ROM never leaves this browser.
          </p>
        </div>

        <ol class="steps">
          <li class="card step">
            <h2 class="step__title"><span class="step__num">01</span> Load a ROM</h2>

            <div class="field">
              <label class="field__label" for="console-select">Console</label>
              <select id="console-select" class="field__control">${consoleOptions()}</select>
            </div>

            <div class="field">
              <label class="field__label" for="rom-input">ROM file</label>
              <input
                type="file"
                id="rom-input"
                class="field__control field__control--file"
                accept="${romAcceptAttribute()}"
              />
            </div>

            <p class="step__status" id="rom-status" data-testid="rom-status" role="status">
              Choose a ROM file for the selected console.
            </p>
          </li>

          <li class="card step">
            <h2 class="step__title"><span class="step__num">02</span> Create or join a room</h2>

            <div class="room-actions">
              <div class="room-action">
                <h3 class="room-action__title">Create a room</h3>
                <p class="room-action__copy">
                  You get a ${ROOM_CODE_LENGTH}-character code to pass along. You host the session.
                </p>
                <button type="button" class="btn btn--primary" id="create-room" data-testid="create-room">
                  Create room
                </button>
              </div>

              <div class="room-action">
                <h3 class="room-action__title">Join with a code</h3>
                <form class="join-form" id="join-form">
                  <label class="field__label" for="join-code">Room code</label>
                  <input
                    type="text"
                    id="join-code"
                    data-testid="join-code"
                    class="field__control field__control--code"
                    maxlength="${ROOM_CODE_LENGTH}"
                    placeholder="${"X".repeat(ROOM_CODE_LENGTH)}"
                    autocomplete="off"
                    autocapitalize="characters"
                    spellcheck="false"
                  />
                  <button type="submit" class="btn btn--ghost" id="join-room" data-testid="join-room">
                    Join room
                  </button>
                </form>
              </div>
            </div>

            <p class="step__status" id="room-hint" data-testid="room-hint" role="status"></p>
            <p class="alert" id="room-error" data-testid="room-error" role="alert" hidden></p>
          </li>
        </ol>
      </section>

      <!-- ── Lobby: room open, waiting for the second player ──────────── -->
      <section class="view view--lobby" id="view-lobby" data-testid="view-lobby" aria-labelledby="lobby-title">
        <div class="card lobby">
          <h2 class="lobby__title" id="lobby-title">Your room is open</h2>
          <p class="lobby__copy">Send this code to the other player. They enter it on their landing screen.</p>

          <p class="code" id="room-code" data-testid="room-code">------</p>

          <div class="lobby__actions">
            <button type="button" class="btn btn--ghost" id="copy-code" data-testid="copy-code">Copy code</button>
            <button type="button" class="btn btn--quiet" id="leave-lobby" data-testid="leave-lobby">Leave room</button>
          </div>

          <p class="lobby__status" id="lobby-status" data-testid="lobby-status" role="status">
            Waiting for player 2…
          </p>
          <p class="lobby__rom">ROM: <span id="lobby-rom" data-testid="lobby-rom">—</span></p>
        </div>
      </section>

      <!-- ── Session: paired, emulator on screen ──────────────────────── -->
      <section class="view view--session" id="view-session" data-testid="view-session" aria-labelledby="session-title">
        <div class="session__bar">
          <h2 class="session__title" id="session-title">Session</h2>
          <span class="chip chip--room" data-testid="session-code">ROOM <span id="session-code">------</span></span>
          <span class="chip" id="session-role" data-testid="session-role">HOST</span>
          <button type="button" class="btn btn--quiet" id="leave-session" data-testid="leave-session">
            Leave room
          </button>
        </div>

        <p class="alert" id="session-alert" data-testid="session-alert" role="alert" hidden></p>

        <div class="session__stage">
          <canvas id="emulator-canvas" class="stage__canvas"></canvas>
        </div>

        <div class="session__controls">
          <button type="button" class="btn btn--primary" id="load" data-testid="start-game" disabled>Start game</button>
          <button type="button" class="btn btn--ghost" id="pause" disabled>Pause</button>
          <button type="button" class="btn btn--ghost" id="resume" disabled>Resume</button>
          <button type="button" class="btn btn--ghost" id="stop" disabled>Stop</button>
        </div>

        <p class="session__status" id="status" data-testid="session-status" role="status">
          Ready when you are.
        </p>
      </section>
    </main>

    <footer class="statusbar" aria-live="polite">
      <span class="chip" id="signaling-chip" data-testid="signaling-chip" data-connection="connecting">
        SIGNALING…
      </span>
      <span class="statusbar__input" id="input-status">
        <span class="chip" id="input-source-chip" data-input-source="keyboard">KEYBOARD</span>
        <span id="input-source-detail">No gamepad detected — keyboard controls active.</span>
      </span>
    </footer>
  </div>
`;
}
