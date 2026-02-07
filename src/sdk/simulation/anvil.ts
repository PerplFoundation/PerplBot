/**
 * Anvil fork process management
 * Starts and stops local Anvil instances for trade simulation
 */

import { spawn, type ChildProcess } from "node:child_process";

export interface AnvilInstance {
  port: number;
  rpcUrl: string;
  process: ChildProcess;
}

/**
 * Check if anvil binary is available in PATH
 */
export async function isAnvilInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("anvil", ["--version"], { stdio: "pipe" });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Start an Anvil fork of the given RPC URL.
 *
 * Uses --port 0 to let the OS pick a free port, then parses
 * Anvil's stdout to extract the actual listening port.
 */
export async function startAnvilFork(
  forkUrl: string,
  opts?: { timeout?: number }
): Promise<AnvilInstance> {
  const timeout = opts?.timeout ?? 30_000;

  const proc = spawn("anvil", [
    "--fork-url", forkUrl,
    "--port", "0",
    "--no-mining",           // mine on-demand (when tx sent)
    "--auto-impersonate",    // allow impersonation without explicit call
    "--steps-tracing",       // enable trace steps for debugging
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise<AnvilInstance>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(
        `Anvil failed to start within ${timeout}ms. stderr: ${stderr}`
      ));
    }, timeout);

    proc.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      // Anvil prints: "Listening on 127.0.0.1:<port>"
      const match = stdout.match(/Listening on [\d.]+:(\d+)/);
      if (match) {
        clearTimeout(timer);
        const port = parseInt(match[1], 10);
        resolve({
          port,
          rpcUrl: `http://127.0.0.1:${port}`,
          process: proc,
        });
      }
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(
          "Anvil not found. Install Foundry: https://getfoundry.sh"
        ));
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      reject(new Error(
        `Anvil exited unexpectedly (code ${code}). stderr: ${stderr}`
      ));
    });
  });
}

/**
 * Stop an Anvil instance gracefully
 */
export function stopAnvil(instance: AnvilInstance): void {
  if (!instance.process.killed) {
    instance.process.kill("SIGTERM");
  }
}
