import { Type } from "@mariozechner/pi-ai";
import type { PreHook, RegisteredTool } from "./types.js";
import { now } from "../events.js";

const MAX_BYTES = 400_000;

const FetchParams = Type.Object({
  url: Type.String({ description: "Absolute http(s) URL to fetch." }),
  reason: Type.Optional(
    Type.String({
      description:
        "Short sentence explaining why this URL is being fetched. Surfaced in logs.",
    }),
  ),
});

export const permissionHook: PreHook = (name, args) => {
  if (name !== "fetch_url") return;
  const url = String((args as { url?: string }).url ?? "");
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { veto: `unsupported protocol: ${u.protocol}` };
    }
  } catch {
    return { veto: `invalid url: ${url}` };
  }
};

export const fetchUrlTool: RegisteredTool<typeof FetchParams> = {
  tool: {
    name: "fetch_url",
    description:
      "Fetch an HTTP(S) URL and return a text extraction (HTML tags stripped, scripts/styles removed). Use for pages surfaced by web_search that warrant deeper reading.",
    parameters: FetchParams,
  },
  concurrent: true,
  preHooks: [permissionHook],
  handler: async ({ url }, ctx) => {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "superdeep-cli/0.1 (+https://github.com; research agent)",
        accept: "text/html,application/xhtml+xml,text/plain,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return {
        content: `fetch failed: ${res.status} ${res.statusText}`,
        isError: true,
      };
    }
    const contentType = res.headers.get("content-type") ?? "";
    const reader = res.body?.getReader();
    if (!reader) return { content: "no response body", isError: true };

    let received = 0;
    const chunks: Uint8Array[] = [];
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
      }
    }
    try {
      await reader.cancel();
    } catch {
      /* noop */
    }

    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const raw = buf.toString("utf-8");
    const text = contentType.includes("html") ? htmlToText(raw) : raw;
    ctx.state.addSource({
      url,
      citedBy: `${ctx.state.role}:fetch_url`,
      at: now(),
    });
    return {
      content: text.slice(0, 20_000),
      details: { url, status: res.status, bytes: received, contentType },
    };
  },
};

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
