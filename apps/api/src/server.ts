import { buildApp } from "./app";
import { loadEnv } from "./env";

const env = loadEnv();

const { app, close } = await buildApp(env);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} diterima, menutup server`);
    void close().then(() => process.exit(0));
  });
}

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
