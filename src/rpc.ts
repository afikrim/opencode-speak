import { Rpc } from "@opencode/plugin/rpc";

const emptyInput = {
  type: "object",
  additionalProperties: false,
} as const;

const enabledOutput = {
  type: "object",
  properties: { enabled: { type: "boolean" } },
  required: ["enabled"],
  additionalProperties: false,
} as const;

export const Speak = Rpc.define({
  id: "speak",
  methods: {
    getState: {
      input: emptyInput,
      output: enabledOutput,
    },
    setEnabled: {
      input: {
        type: "object",
        properties: { enabled: { type: "boolean" } },
        required: ["enabled"],
        additionalProperties: false,
      } as const,
      output: enabledOutput,
    },
    normalize: {
      input: {
        type: "object",
        properties: {
          text: { type: "string" },
          mode: { type: "string" },
        },
        required: ["text", "mode"],
        additionalProperties: false,
      } as const,
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      } as const,
    },
  },
  events: {},
});
