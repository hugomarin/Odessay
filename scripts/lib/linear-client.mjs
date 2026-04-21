const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

function loadLocalEnvFiles() {
  if (typeof process.loadEnvFile !== "function") {
    return;
  }

  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Ignore missing files and preserve the current environment.
    }
  }
}

function formatLinearErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return null;
  }

  return errors
    .map((error) => {
      const code = error?.extensions?.code;
      return code ? `${code}: ${error.message}` : error.message;
    })
    .join("\n");
}

export async function linearGraphQL(query, { variables, apiKey } = {}) {
  loadLocalEnvFiles();

  const resolvedApiKey = apiKey?.trim() || process.env.LINEAR_API_KEY?.trim();

  if (!resolvedApiKey) {
    throw new Error("Missing LINEAR_API_KEY");
  }

  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: resolvedApiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const rawBody = await response.text();
  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error(`Linear returned a non-JSON response (${response.status}).`);
  }

  const formattedErrors = formatLinearErrors(payload.errors);
  if (!response.ok || formattedErrors) {
    const statusText = `${response.status} ${response.statusText}`.trim();
    throw new Error(
      `Linear request failed (${statusText}).${formattedErrors ? `\n${formattedErrors}` : ""}`,
    );
  }

  return payload.data;
}
