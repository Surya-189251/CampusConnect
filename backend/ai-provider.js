const openai = require("./openai-client");

const providers = {
  groq: {
    keyName: "GROQ_API_KEY",
    modelName: "GROQ_MODEL",
    defaultModel: "openai/gpt-oss-120b",
    url: "https://api.groq.com/openai/v1/chat/completions",
  },

  gemini: {
    keyName: "GEMINI_API_KEY",
    modelName: "GEMINI_MODEL",
    defaultModel: "gemini-3.8-flash",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  },

  openrouter: {
    keyName: "OPENROUTER_API_KEY",
    modelName: "OPENROUTER_MODEL",
    defaultModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
    url: "https://openrouter.ai/api/v1/chat/completions",
  },
};

function issue(message, code, status = 503) {
  return Object.assign(new Error(message), { status, code });
}

function settings() {
  const name = (process.env.AI_PROVIDER || "groq")
    .trim()
    .toLowerCase();

  if (name === "openai") {
    return { ...openai.settings(), provider: name };
  }

  const provider = providers[name];

  if (!provider) {
    return {
      provider: name,
      key: "",
      model: "",
    };
  }

  return {
    provider: name,
    key: (process.env[provider.keyName] || "").trim(),
    model:
      (process.env[provider.modelName] || "").trim() ||
      provider.defaultModel,
    url: provider.url,
  };
}

function responseError(provider, status, code) {
  const label = provider.toUpperCase();

  if (status === 401) {
    return issue(
      `${label} rejected the API key. Check backend .env and restart.`,
      "invalid_api_key"
    );
  }

  if (status === 402 || code === "insufficient_quota") {
    return issue(
      `${label} has no available credit or quota. Check the provider account.`,
      "quota_exhausted"
    );
  }

  if (status === 429) {
    return issue(
      `${label} has reached a request, token, or quota limit. Check its Limits page before retrying.`,
      "provider_limit"
    );
  }

  if (status === 403) {
    return issue(
      `${label} denied this request. Check account permissions and model access.`,
      "permission_denied"
    );
  }

  if (status === 404) {
    return issue(
      `${label} could not find the configured model. Check the model name in backend .env.`,
      "model_unavailable"
    );
  }

  if (status === 400 || status === 422) {
    return issue(
      `${label} rejected the request settings. Send the terminal status and error code to your developer.`,
      "invalid_request"
    );
  }

  return issue(
    `${label} is temporarily unavailable. Please try again later.`,
    "provider_unavailable"
  );
}

async function answer(instructions, messages) {
  const config = settings();

  if (!config.key || config.key.startsWith("PASTE_")) {
    throw issue(
      "The selected AI provider has no configured API key.",
      "missing_key"
    );
  }

  if (config.provider === "openai") {
    return openai.answer(instructions, messages);
  }

  const body = {
    model: config.model,
    messages: [
      {
        role: "system",
        content: instructions,
      },
      ...messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ],
    stream: false,
    max_tokens: 2048,
  };

  if (
    config.provider === "groq" &&
    config.model.startsWith("openai/gpt-oss-")
  ) {
    body.reasoning_effort = "low";
  }

  if (config.provider === "gemini") {
    body.reasoning_effort = "low";
  }

  let response;
  let data;

  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });

    data = await response.json().catch(() => null);
  } catch {
    throw issue(
      `${config.provider.toUpperCase()} could not be reached within the time limit. Please retry later.`,
      "connection_failed"
    );
  }

  if (!response.ok || data?.error) {
    const rawCode = data?.error?.code;

    // Log only a short error identifier, never keys or chat content.
    const safeCode =
      typeof rawCode === "number" ||
      (typeof rawCode === "string" &&
        /^[a-zA-Z0-9_.-]{1,80}$/.test(rawCode))
        ? rawCode
        : "unspecified";

    console.error(
      "AI provider error:",
      config.provider,
      "HTTP:",
      response.status,
      "Code:",
      safeCode
    );

    throw responseError(
      config.provider,
      response.status,
      rawCode
    );
  }

  const choice = data?.choices?.[0];
  const message = choice?.message;

  if (
    choice?.finish_reason === "content_filter" ||
    message?.refusal
  ) {
    return {
      answer:
        typeof message?.refusal === "string"
          ? message.refusal.slice(0, 6000)
          : "I cannot help with that request. Please ask a different question.",
      incomplete: false,
    };
  }

  const text =
    typeof message?.content === "string"
      ? message.content.trim()
      : "";

  if (!text) {
    throw issue(
      "The AI returned no readable answer. Try a shorter question.",
      "empty_answer"
    );
  }

  return {
    answer: text.slice(0, 6000),
    incomplete:
      choice?.finish_reason === "length" ||
      text.length > 6000,
  };
}

module.exports = {
  settings,
  answer,
};