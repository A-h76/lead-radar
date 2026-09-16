// Shared OpenAI call for the website's two on-demand AI features (Role 2
// analysis of manual leads, Role 3 outreach drafting). The automated n8n
// pipeline has its own copy of the request shape in
// n8n/lead-radar.workflow.json -- duplicated rather than shared because the
// two run in different runtimes, same trade-off already made for
// toLines/fromLines in lib/airtable.ts.
import { fetchWithTimeout } from "./http";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export const isOpenAIConfigured = Boolean(OPENAI_API_KEY);

export async function callOpenAIJson(
  systemPrompt: string,
  userContent: string
): Promise<Record<string, unknown>> {
  if (!OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set on the website. (This is separate from n8n's copy -- both need it.)"
    );
  }

  const res = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    },
    // A model call is not safely retriable on our side by default (retrying
    // after a timeout could double the cost of an already-completed call
    // whose response we just never saw) -- the caller (analyze/draft routes)
    // already rolls back its own state cleanly on any failure here, so a
    // single 30s attempt with no silent retry is the safer choice.
    { timeoutMs: 30000, retries: 0 }
  );

  if (!res.ok) {
    throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI response had no content.");

  try {
    return JSON.parse(content);
  } catch {
    throw new Error("OpenAI response was not valid JSON.");
  }
}
