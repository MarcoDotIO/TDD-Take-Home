import { createApp } from "./app";

const port = Number(process.env.API_PORT ?? 8787);

Bun.serve({
  port,
  fetch: createApp().fetch
});

console.info(`COLA API listening on http://localhost:${port}`);
