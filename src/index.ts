// opencode-speak server part (thin).
// Owns the shared enabled flag and speech normalization via the user's
// OpenCode Go model. All triggers and audio playback live in the TUI part,
// so each window speaks only the session it is showing.

import { Plugin } from "@opencode/plugin";
import { Speak } from "./rpc.js";
import { createLogger } from "./log.js";
import { SYSTEM_AUTO, SYSTEM_MANUAL } from "./prompts.js";

interface SpeakOptions {
  enabled?: boolean;
  normalizeProvider?: string;
  normalizeModel?: string;
  debugLog?: boolean;
}

const DEFAULTS = {
  enabled: false,
  normalizeProvider: "opencode-go",
  normalizeModel: "deepseek-v4.1-flash",
  debugLog: false,
} as const;

function getOptions(raw: unknown): Required<SpeakOptions> {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    normalizeProvider:
      typeof o.normalizeProvider === "string" ? o.normalizeProvider : DEFAULTS.normalizeProvider,
    normalizeModel:
      typeof o.normalizeModel === "string" ? o.normalizeModel : DEFAULTS.normalizeModel,
    debugLog: o.debugLog === true,
  };
}

export default Plugin.define({
  id: "speak",
  async setup(ctx) {
    const options = getOptions((ctx as any).options);
    const myDir = (ctx.location as { directory?: string }).directory ?? "unknown";
    const log = createLogger(options.debugLog, `speak-server:${myDir}`);
    log.log(`setup model=${options.normalizeProvider}/${options.normalizeModel}`);

    const isEnabled = async (): Promise<boolean> =>
      ((await ctx.storage.get("enabled")) as boolean | undefined) ?? options.enabled;

    async function normalize(raw: string, mode: string): Promise<string> {
      const experimental = (ctx as any).experimental;
      const system = mode === "manual" ? SYSTEM_MANUAL : SYSTEM_AUTO;
      if (!experimental?.generate?.text) {
        log.log("normalize unavailable: no experimental.generate.text");
        return "";
      }
      const started = Date.now();
      const timeout = new Promise<null>((resolve) => setTimeout(resolve, 45_000));
      try {
        const result = (await Promise.race([
          experimental.generate.text({
            model: { providerID: options.normalizeProvider, id: options.normalizeModel },
            prompt: `${system}\n\nConvert for text-to-speech:\n\n${raw}`,
          }),
          timeout,
        ])) as { text?: unknown } | null;
        if (!result) {
          log.log(`normalize timeout rawChars=${raw.length}`);
          return "";
        }
        const text = String(result.text ?? "").trim();
        log.log(
          `normalize ok mode=${mode} ms=${Date.now() - started} rawChars=${raw.length} outChars=${text.length}`,
        );
        return text;
      } catch (err) {
        log.log(`normalize error: ${err instanceof Error ? err.message : String(err)}`);
        return "";
      }
    }

    await ctx.rpc.register(Speak, {
      getState: async () => ({ enabled: await isEnabled() }),
      setEnabled: async (input) => {
        const enabled = (input as { enabled: boolean }).enabled;
        await ctx.storage.set("enabled", enabled);
        log.log(`rpc setEnabled=${enabled}`);
        return { enabled };
      },
      normalize: async (input) => {
        const { text, mode } = input as { text: string; mode: string };
        return { text: await normalize(String(text ?? ""), mode === "manual" ? "manual" : "auto") };
      },
    });

    await ctx.command.transform((editor) => {
      editor.add({
        name: "speak-on",
        description: "Turn text-to-speech on",
        execute: async () => {
          await ctx.storage.set("enabled", true);
          log.log("cmd speak-on");
        },
      });
      editor.add({
        name: "speak-off",
        description: "Turn text-to-speech off",
        execute: async () => {
          await ctx.storage.set("enabled", false);
          log.log("cmd speak-off");
        },
      });
    });

    return () => {
      log.log("unload");
    };
  },
});
