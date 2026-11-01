// opencode-speak TUI part: per-window trigger + local playback.
// Speaks only the session this window is showing. Normalization runs on the
// server (your Go model); audio is synthesized locally via `say` or Edge TTS.

import { Plugin } from "@opencode/plugin/tui";
import { Speak } from "./rpc.js";
import { createSpeaker, type EngineName } from "./tts.js";
import { stripMarkdown, truncate } from "./prompts.js";

const DEFAULT_MAX_CHARS = 800;

function getOption(raw: unknown, key: string, fallback: string): string {
  const value = (raw as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" && value ? value : fallback;
}

function currentSessionID(context: any): string | undefined {
  const route = context.ui.router.current();
  return route?.type === "session" ? (route.sessionID as string) : undefined;
}

function showingSession(context: any, sessionID: string): boolean {
  const route = context.ui.router.current();
  // Not looking at a session: speak anyway (single-window setups).
  if (route?.type !== "session") return true;
  return route.sessionID === sessionID;
}

/** Assistant messages of the current turn (since the last user message). */
function getTurnAssistantText(context: any, sessionID: string): { lastMessageID: string; text: string } | null {
  const messages = (context.data.session.message.list(sessionID) ?? []) as Record<string, any>[];
  const assistant: { id: string; text: string }[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const type = m.type ?? m.role ?? "";
    if (type === "user") break;
    if (type !== "assistant") continue;
    const text = (Array.isArray(m.content) ? m.content : [])
      .filter((p: any) => p?.type === "text")
      .map((p: any) => String(p.text ?? ""))
      .join("\n\n")
      .trim();
    if (text) assistant.unshift({ id: String(m.id ?? ""), text });
  }
  if (assistant.length === 0) return null;
  return {
    lastMessageID: assistant[assistant.length - 1].id,
    text: assistant.map((a) => a.text).join("\n\n"),
  };
}

export default Plugin.define({
  id: "speak-tui",
  setup(context) {
    const options = context.options as Record<string, unknown> | undefined;
    const engine = (getOption(options, "engine", "edge") === "say" ? "say" : "edge") as EngineName;
    const voice = getOption(
      options,
      "voice",
      engine === "edge" ? "en-US-AriaNeural" : "Samantha",
    );
    const sayFallback = getOption(options, "sayVoice", "Samantha");
    const rawMax = (options as any)?.maxChars;
    const maxChars = typeof rawMax === "number" && rawMax > 0 ? Math.floor(rawMax) : DEFAULT_MAX_CHARS;

    type Variant = "info" | "success" | "warning" | "error";
    const toast = (message: string, variant: Variant = "info") =>
      context.ui.toast.show({ message, variant, duration: 3000 });
    const log = (message: string) => {
      if ((options as any)?.debugLog === true) console.log(`[speak-tui] ${message}`);
    };

    const rpc = () => (context.client as any).rpc(Speak);
    const speaker = createSpeaker({ engine, voice }, sayFallback, log, (m) => toast(m, "warning"));

    const busySessions = new Set<string>();
    let lastSpokenMessageID: string | null = null;
    const unsubscribers: (() => void)[] = [];
    type DataEvent = Parameters<typeof context.data.on>[0];
    const on = (type: DataEvent, handler: (event: any) => void) => {
      unsubscribers.push(context.data.on(type, handler));
    };

    async function normalize(text: string, mode: "auto" | "manual"): Promise<string> {
      try {
        const result = (await rpc().normalize({ text, mode })) as { text?: unknown };
        return String(result?.text ?? "").trim();
      } catch (err) {
        toast(`Normalize failed: ${errText(err).slice(0, 160)}`, "warning");
        return "";
      }
    }

    async function speakTurn(sessionID: string, mode: "auto" | "manual", suffix: string): Promise<void> {
      const turn = getTurnAssistantText(context, sessionID);
      if (!turn) {
        if (mode === "manual") toast("No assistant response to speak", "warning");
        return;
      }
      if (mode === "auto") {
        if (turn.lastMessageID === lastSpokenMessageID) return;
        lastSpokenMessageID = turn.lastMessageID || null;
      }
      toast(mode === "manual" ? "Reading response aloud" : "Normalizing response...");
      const normalized = await normalize(turn.text, mode);
      const spoken =
        normalized || truncate(stripMarkdown(turn.text), mode === "manual" ? maxChars * 2 : maxChars);
      speaker.speak(normalized ? `${spoken} ${suffix}`.trim() : spoken, mode);
    }

    on("session.execution.started", (event: any) => {
      if (event?.data?.sessionID) busySessions.add(event.data.sessionID);
    });
    const onTurnEnd = (event: any) => {
      const sessionID = event?.data?.sessionID as string | undefined;
      if (!sessionID) return;
      if (!busySessions.delete(sessionID)) return;
      rpc()
        .getState({})
        .then((state: any) => {
          if (!state?.enabled) return;
          if (!showingSession(context, sessionID)) {
            log(`skip background session=${sessionID}`);
            return;
          }
          void speakTurn(sessionID, "auto", "");
        })
        .catch(() => {});
    };
    on("session.execution.succeeded", onTurnEnd);
    on("session.execution.interrupted", onTurnEnd);
    on("session.execution.failed", (event: any) => {
      if (event?.data?.sessionID) busySessions.delete(event.data.sessionID);
    });

    const errText = (err: unknown) =>
      err instanceof Error ? err.message : (() => { try { return JSON.stringify(err); } catch { return String(err); } })();

    async function toggle(): Promise<void> {
      try {
        const state = (await rpc().getState({})) as { enabled: boolean };
        const next = !state.enabled;
        await rpc().setEnabled({ enabled: next });
        if (!next) speaker.stop("disabled");
        toast(next ? `Speak on (${engine}, ${voice})` : "Speak off");
      } catch (err) {
        toast(`Speak unavailable: ${errText(err).slice(0, 160)}`, "warning");
      }
    }

    async function speakLast(): Promise<void> {
      const sessionID = currentSessionID(context);
      if (!sessionID) {
        toast("Open a session before reading aloud", "warning");
        return;
      }
      await speakTurn(sessionID, "manual", "");
    }

    function stopQuiet(): void {
      if (speaker.stop("manual-stop")) toast("Speech stopped");
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "speak.toggle",
          title: "Speak: toggle auto read-aloud",
          bind: "<leader>v",
          palette: true,
          slash: { name: "speak-mode" },
          run: () => toggle(),
        },
        {
          id: "speak.speak-last",
          title: "Speak: read last response aloud",
          bind: "<leader>s",
          palette: true,
          slash: { name: "tts-speak" },
          run: () => speakLast(),
        },
        {
          id: "speak.stop",
          title: "Speak: stop playback",
          bind: "escape",
          palette: true,
          slash: { name: "speak-stop" },
          run: () => {
            // Always fall through so escape still reaches session interrupt.
            stopQuiet();
            return false;
          },
        },
      ],
    }));

    return () => {
      while (unsubscribers.length > 0) {
        try {
          unsubscribers.pop()!();
        } catch {
          // A dead listener must not block the rest of the cleanup.
        }
      }
      speaker.stop("unload");
    };
  },
});
