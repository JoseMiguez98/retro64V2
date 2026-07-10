import { io } from "socket.io-client";
import type { PocPaired, PocSignal } from "@retro64/shared";
import "../style.css";

// DMI-2 POC — proves a WebRTC DataChannel connection between two local tabs,
// signaled through the Socket.io server. Not the real lobby/room UI (DMI-25)
// or signaling protocol (DMI-19/20/21) — standalone page, unlinked from the
// landing scaffold.

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL ?? "http://localhost:3001";
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
  <main>
    <h1>P2P transport POC (DMI-2)</h1>
    <p id="status">connecting to signaling server…</p>
    <form id="send-form">
      <input id="message" type="text" placeholder="message" disabled autocomplete="off" />
      <button type="submit" disabled>send</button>
    </form>
    <pre id="log"></pre>
  </main>
`;

const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const logEl = document.querySelector<HTMLPreElement>("#log")!;
const form = document.querySelector<HTMLFormElement>("#send-form")!;
const input = document.querySelector<HTMLInputElement>("#message")!;
const sendBtn = form.querySelector<HTMLButtonElement>("button")!;

function log(line: string) {
  logEl.textContent += `${line}\n`;
}

function setStatus(text: string) {
  statusEl.textContent = text;
}

const socket = io(SIGNALING_URL);
let pc: RTCPeerConnection | undefined;
let channel: RTCDataChannel | undefined;

function wireChannel(ch: RTCDataChannel) {
  channel = ch;
  channel.onopen = () => {
    setStatus("data channel open");
    input.disabled = false;
    sendBtn.disabled = false;
  };
  channel.onclose = () => setStatus("data channel closed");
  channel.onmessage = (e) => log(`< ${e.data}`);
}

socket.on("connect", () => setStatus("waiting for a peer…"));

socket.on("poc:paired", async ({ initiator }: PocPaired) => {
  setStatus(`paired (initiator=${initiator}) — negotiating…`);
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("poc:signal", { type: "ice-candidate", data: e.candidate.toJSON() } satisfies PocSignal);
    }
  };
  pc.onconnectionstatechange = () => log(`connection state: ${pc?.connectionState}`);

  if (initiator) {
    wireChannel(pc.createDataChannel("poc"));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("poc:signal", { type: "offer", data: offer } satisfies PocSignal);
  } else {
    pc.ondatachannel = (e) => wireChannel(e.channel);
  }
});

socket.on("poc:signal", async (msg: PocSignal) => {
  if (!pc) return;
  if (msg.type === "offer") {
    await pc.setRemoteDescription(msg.data as RTCSessionDescriptionInit);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("poc:signal", { type: "answer", data: answer } satisfies PocSignal);
  } else if (msg.type === "answer") {
    await pc.setRemoteDescription(msg.data as RTCSessionDescriptionInit);
  } else if (msg.type === "ice-candidate") {
    await pc.addIceCandidate(msg.data as RTCIceCandidateInit);
  }
});

socket.emit("poc:join");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!channel || channel.readyState !== "open" || !input.value) return;
  channel.send(input.value);
  log(`> ${input.value}`);
  input.value = "";
});
