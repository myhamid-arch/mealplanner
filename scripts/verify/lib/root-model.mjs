// The recorded model reaches the compose stack through this relay (R-80; "the model is recorded, as
// in the node N3s"). The test process starts the node gates' recorded-model server
// (apps/web/test/node/recorded-model.ts, on 127.0.0.1) and writes its port to `targetFile`; the
// containers' ANTHROPIC_BASE_URL is http://host.docker.internal:<relay port>, and every connection
// they open is piped to that server. A connection that arrives before the test has named a server
// is refused and counted, so the gate can require that none was lost. Once the gate's test has
// ended (`endOfTest`), the test's recorded server is gone: later connections (a scheduled worker
// job before teardown) are refused and counted apart, as outside the measured flow. Nothing is
// forwarded anywhere else, so no request can leave the machine.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

function targetPort(file) {
  try {
    const { port } = JSON.parse(readFileSync(file, "utf8"));
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}

/** Listens on `host` (the Docker host's bridge address) at a free port. */
export async function startRelay(host) {
  const dir = mkdtempSync(join(tmpdir(), "root-model-relay-"));
  const targetFile = join(dir, "target.json");
  const stats = { forwarded: 0, refused: 0, errors: [], afterTest: 0 };
  let ended = false;
  const server = createServer((socket) => {
    if (ended) {
      stats.afterTest += 1;
      socket.destroy();
      return;
    }
    const port = targetPort(targetFile);
    if (port === undefined) {
      stats.refused += 1;
      socket.destroy();
      return;
    }
    stats.forwarded += 1;
    const upstream = createConnection({ host: "127.0.0.1", port });
    const fail = (error) => {
      if (!ended) stats.errors.push(String(error));
      socket.destroy();
      upstream.destroy();
    };
    upstream.on("error", fail);
    socket.on("error", () => upstream.destroy());
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  return {
    host,
    port: server.address().port,
    targetFile,
    stats,
    /** The gate's test process has exited: nothing after this is part of the measured flow. */
    endOfTest: () => {
      ended = true;
    },
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          rmSync(dir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}
