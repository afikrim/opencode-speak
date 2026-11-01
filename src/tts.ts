// TUI-side speech synthesis: `say` (built-in, robotic) or Edge TTS
// (free Microsoft neural voices, needs `edge-tts` on PATH + internet).
// Only one engine speaks at a time; a new speak preempts the old.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type EngineName = "say" | "edge";

export interface EngineOptions {
  engine: EngineName;
  /** say voice name or Edge voice id (e.g. en-US-AriaNeural). */
  voice: string;
}

export interface Speaker {
  speak(text: string, source: string): void;
  stop(reason: string): boolean;
}

function findEdgeBinary(): string | null {
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, "edge-tts");
    if (fs.existsSync(candidate)) return candidate;
  }
  const homeBin = path.join(os.homedir(), ".local", "bin", "edge-tts");
  if (fs.existsSync(homeBin)) return homeBin;
  return null;
}

export function createSpeaker(
  options: EngineOptions,
  sayFallbackVoice: string,
  log: (message: string) => void,
  toast: (message: string) => void,
): Speaker {
  let current: ChildProcess[] = [];
  let tmpFile: string | null = null;

  function killAll(reason: string): boolean {
    const wasPlaying = current.length > 0;
    for (const proc of current) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    }
    current = [];
    if (tmpFile) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Already gone.
      }
      tmpFile = null;
    }
    if (wasPlaying) log(`kill reason=${reason}`);
    return wasPlaying;
  }

  function track(proc: ChildProcess, label: string): void {
    current.push(proc);
    proc.on("close", (code) => {
      current = current.filter((p) => p !== proc);
      log(`proc close label=${label} pid=${proc.pid} code=${code}`);
    });
    proc.on("error", (err) => {
      current = current.filter((p) => p !== proc);
      log(`proc error label=${label} message=${(err as Error).message}`);
    });
  }

  function speakSay(text: string, voice: string, source: string): void {
    killAll("preempt");
    const child = spawn("say", ["-v", voice, text], { stdio: "ignore" });
    log(`speak start engine=say pid=${child.pid} chars=${text.length} source=${source}`);
    track(child, "say");
  }

  function speakEdge(text: string, voice: string, source: string): void {
    const binary = findEdgeBinary();
    if (!binary) {
      log("edge binary missing, falling back to say");
      toast("edge-tts not found, using system voice");
      speakSay(text, sayFallbackVoice, `${source}-say-fallback`);
      return;
    }
    killAll("preempt");
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "speak-")),
      "speech.mp3",
    );
    tmpFile = file;
    const gen = spawn(binary, ["--voice", voice, "--text", text, "--write-media", file], {
      stdio: "ignore",
    });
    log(`edge generate start pid=${gen.pid} chars=${text.length} source=${source}`);
    track(gen, "edge-tts");
    gen.on("close", (code) => {
      if (code !== 0) {
        log(`edge generate failed code=${code}, falling back to say`);
        speakSay(text, sayFallbackVoice, `${source}-say-fallback`);
        return;
      }
      const play = spawn("afplay", [file], { stdio: "ignore" });
      log(`speak start engine=edge pid=${play.pid} chars=${text.length} source=${source}`);
      track(play, "afplay");
    });
  }

  return {
    speak(text: string, source: string) {
      const line = text.replace(/\s+/g, " ").trim();
      if (!line) {
        log(`speak skip empty source=${source}`);
        return;
      }
      if (options.engine === "edge") speakEdge(line, options.voice, source);
      else speakSay(line, options.voice, source);
    },
    stop: (reason: string) => killAll(reason),
  };
}
