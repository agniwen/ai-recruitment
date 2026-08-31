type ProviderJsonValue =
  | null
  | string
  | number
  | boolean
  | ProviderJsonObject
  | ProviderJsonValue[];
interface ProviderJsonObject {
  [key: string]: ProviderJsonValue;
}

function asProviderSettings(value: unknown): ProviderJsonObject {
  return typeof value === "object" && value !== null ? (value as ProviderJsonObject) : {};
}

export interface DisabledThinkingProviderOptions {
  [providerId: string]: ProviderJsonObject;
  alibaba: { enableThinking: false };
  google: {
    thinkingConfig: { includeThoughts: false; thinkingBudget: 0 };
  };
  openai: { reasoningEffort: "none" };
}

export const DISABLED_THINKING_PROVIDER_OPTIONS: DisabledThinkingProviderOptions = {
  alibaba: { enableThinking: false },
  google: {
    thinkingConfig: { includeThoughts: false, thinkingBudget: 0 },
  },
  openai: { reasoningEffort: "none" },
};

export function withModelThinkingDisabled(
  providerOptions?: unknown,
): DisabledThinkingProviderOptions {
  const options = asProviderSettings(providerOptions);
  const google = asProviderSettings(options.google);

  return {
    ...options,
    alibaba: {
      ...asProviderSettings(options.alibaba),
      enableThinking: false,
    },
    google: {
      ...google,
      thinkingConfig: {
        ...asProviderSettings(google.thinkingConfig),
        includeThoughts: false,
        thinkingBudget: 0,
      },
    },
    openai: {
      ...asProviderSettings(options.openai),
      reasoningEffort: "none",
    },
  };
}
