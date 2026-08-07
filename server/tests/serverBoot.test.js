// Prueba de humo end-to-end real: arranca el proceso del servidor tal cual
// lo haría `npm start` (no solo la app exportada vía createApp()+supertest),
// confirma que escucha y responde en un puerto TCP real, y lo apaga.
// Usa un PORT distinto al de desarrollo (4000) para no chocar con una
// instancia que ya esté corriendo en la máquina.

import { describe, it, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(__dirname, "..", "src", "index.js");
const TEST_PORT = 4123;

let child;

afterAll(() => {
  if (child && !child.killed) {
    child.kill();
  }
});

function waitForServerReady(proc, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout esperando a que el servidor arranque")), timeoutMs);
    let output = "";
    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("API escuchando")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`El proceso del servidor terminó prematuramente (código ${code}). Salida:\n${output}`));
    });
  });
}

describe("Arranque real del servidor (proceso completo, no solo la app en memoria)", () => {
  it("levanta, escucha en el puerto configurado y responde GET /health", async () => {
    child = spawn(process.execPath, [serverEntry], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, PORT: String(TEST_PORT) },
    });

    await waitForServerReady(child);

    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: "ok", database: "connected" });
  });
});
