import { withDeadline } from "../shared/async.ts";
import { authorizationUrl } from "../shared/protocol.ts";
import { agentCommand } from "./agent-process.ts";
import { ClaudeTerminal } from "./claude-terminal.ts";
import type { ActionsContext, StepEnvironment } from "./context.ts";
import { createLoginChannel, type LoginRunnerChannel, type RunnerPorts, runSession } from "./session.ts";
import { VscodeSession } from "./vscode.ts";

const CODE_POLL_MS = 5_000;
const AUTHORIZATION_URL_TIMEOUT_MS = 90_000;

/** Authorizes the shared account through the owner's browser or a temporary desktop tunnel. */
export async function runLogin(
    context: ActionsContext,
    environment: StepEnvironment,
    ports: RunnerPorts,
    signal: AbortSignal,
): Promise<void> {
    await runSession(context, ports, signal, {
        create: createLoginChannel,
        reportFailure: (channel, code, failureSignal) =>
            channel.send({ kind: "failed", body: { code } }, failureSignal),
        work: ({ channel, deadline }, sessionSignal) =>
            withDeadline(
                Math.max(0, deadline - ports.clock.now()),
                sessionSignal,
                async (bounded) => {
                    const path = environment["PATH"] ?? "";
                    const vscode =
                        context.inputs.login_access === "vscode"
                            ? new VscodeSession(context, path, { kind: "login" }, ports.clock, ports.diagnostics)
                            : null;
                    try {
                        const entry =
                            vscode === null
                                ? null
                                : await vscode.connect(
                                      {
                                          challenge: (code, signal) =>
                                              channel.send({ kind: "vscode_challenge", body: { code } }, signal),
                                          // Login cancellation uses the existing authenticated GitHub run cancellation.
                                          stopRequested: async (signal) => {
                                              signal.throwIfAborted();
                                              return false;
                                          },
                                      },
                                      bounded,
                                  );
                        if (entry?.kind === "stopped") {
                            return;
                        }
                        const command = await agentCommand(
                            context.agent,
                            path,
                            context.agent.home,
                            "claude",
                            ["setup-token"],
                            {
                                TERM: "xterm-256color",
                                BROWSER: "false",
                                DISABLE_AUTOUPDATER: "1",
                                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                            },
                        );
                        const terminal = new ClaudeTerminal(command);
                        try {
                            // Generate Claude's authorization only after the desktop connection is ready.
                            const url = authorizationUrl(
                                await withDeadline(AUTHORIZATION_URL_TIMEOUT_MS, bounded, terminal.authorization),
                            );
                            if (entry === null) {
                                await channel.send({ kind: "challenge", body: { url } }, bounded);
                            } else {
                                await channel.send(
                                    { kind: "vscode_login_ready", body: { url: entry.url, authorizationUrl: url } },
                                    bounded,
                                );
                            }
                            ports.diagnostics({ event: "session.stage", stage: "awaiting_authorization" });
                            const code = await waitForCode(channel, ports, bounded, vscode);
                            ports.diagnostics({ event: "session.stage", stage: "completing_authorization" });
                            const token = await terminal.complete(code, bounded);
                            await channel.send({ kind: "token", body: { token } }, bounded);
                            ports.diagnostics({ event: "session.stage", stage: "authorized" });
                        } finally {
                            await terminal.dispose();
                        }
                    } finally {
                        await vscode?.stop();
                    }
                },
                ports.clock,
            ),
    });
}

async function waitForCode(
    channel: LoginRunnerChannel,
    ports: RunnerPorts,
    signal: AbortSignal,
    vscode: VscodeSession | null,
): Promise<string> {
    for (;;) {
        vscode?.assertRunning();
        const code = (await channel.receive(signal)).find((message) => message.kind === "code");
        if (code !== undefined) {
            return code.body.code;
        }
        await ports.clock.sleep(CODE_POLL_MS, signal);
    }
}
