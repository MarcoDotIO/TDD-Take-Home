import { createApp } from "./app";

interface FunctionUrlEvent {
  version: "2.0";
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: {
    domainName?: string;
    http?: {
      method?: string;
    };
  };
}

const app = createApp();

export async function handler(event: FunctionUrlEvent) {
  const method = event.requestContext?.http?.method ?? "GET";
  const domain = event.requestContext?.domainName ?? "localhost";
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const url = `https://${domain}${event.rawPath}${query}`;
  const body =
    event.body === undefined
      ? undefined
      : event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body;

  const response = await app.fetch(
    new Request(url, {
      method,
      headers: event.headers,
      body
    })
  );

  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text()
  };
}
