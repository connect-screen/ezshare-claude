import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getByRole, getByText, queryByRole } from "@testing-library/dom";
import { afterEach, expect, test } from "vitest";
import { connect } from "./support/scenario.ts";
import { createTestApp, type TestApp, tokens } from "./support/test-app.ts";

let app: TestApp | undefined;
afterEach(async () => {
    await app?.close();
    app = undefined;
});

test("Given a member chooses VS Code, When authorization is needed, Then she sees a private device challenge and can cancel cleanly", async () => {
    app = await createTestApp();
    const body = document.body;
    await connect(app, tokens.alice);
    const choice = await app.eventually(() => getByRole(body, "combobox", { name: "Open with" }));
    await app.user.selectOptions(choice, "vscode");
    expect(queryByRole(body, "checkbox", { name: "Use a new Morty identity" })).toBeNull();
    await app.user.click(getByRole(body, "button", { name: "Start a session" }));
    const authorize = await app.eventually(() => getByRole(body, "link", { name: /Authorize VS Code/u }));
    expect(authorize.getAttribute("href")).toBe("https://github.com/login/device");
    expect(getByText(body, "ABCD-EFGH")).toBeTruthy();
    expect(app.github.runs[0]?.inputs["access"]).toBe("vscode");
    await app.user.click(getByRole(body, "button", { name: "Cancel" }));
    await app.eventually(() => getByRole(body, "button", { name: "Start a session" }));
    expect(app.github.runs[0]?.conclusion).toBe("success");
});

test("Given a member authorizes VS Code, When she reloads, restarts VS Code and later chooses Morty, Then the private entry, login, workspace and Claude conversation continue", async () => {
    app = await createTestApp();
    const body = document.body;
    await connect(app, tokens.alice);
    await app.user.selectOptions(
        await app.eventually(() => getByRole(body, "combobox", { name: "Open with" })),
        "vscode",
    );
    await app.user.click(getByRole(body, "button", { name: "Start a session" }));
    await app.eventually(() => getByText(body, "ABCD-EFGH"));
    app.reload();
    await app.eventually(() => getByText(body, "ABCD-EFGH"));
    const run = app.github.runs[0];
    if (run === undefined) {
        throw new Error("Expected the first VS Code run");
    }
    await app.actions.authorizeVscode(run.id);
    const first = (await app.eventually(() => getByRole(body, "link", { name: /Open VS Code/u }))).getAttribute("href");
    expect(new URL(first ?? "").origin).toBe("https://vscode.dev");
    await app.actions.editVscodeWorkspace(run.id);
    app.reload();
    expect((await app.eventually(() => getByRole(body, "link", { name: /Open VS Code/u }))).getAttribute("href")).toBe(
        first,
    );
    const home = app.actions.jobs.get(run.id)?.agentHome;
    if (home === undefined) {
        throw new Error("Expected the personal workspace");
    }
    const settings: unknown = JSON.parse(await readFile(join(home, "workspace", ".vscode", "settings.json"), "utf8"));
    expect(settings).toMatchObject({
        "terminal.integrated.defaultProfile.linux": "Ezshare Claude",
    });
    const memberSettings = '// My existing VS Code settings\n{"terminal.integrated.defaultProfile.linux":"bash",}\n';
    await writeFile(join(home, "workspace", ".vscode", "settings.json"), memberSettings);
    for (const entry of await app.actions.agentLog(run.id)) {
        expect(entry.names.some((name) => name.startsWith("GH_") || name.startsWith("GITHUB_"))).toBe(false);
        if (entry.program === "code" && entry.command.startsWith("tunnel user")) {
            expect(entry.names).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
        }
    }
    await app.user.click(getByRole(body, "button", { name: "End session" }));
    await app.eventually(() => getByRole(body, "button", { name: "Start a session" }));
    await app.user.selectOptions(getByRole(body, "combobox", { name: "Open with" }), "vscode");
    await app.user.click(getByRole(body, "button", { name: "Start a session" }));
    expect((await app.eventually(() => getByRole(body, "link", { name: /Open VS Code/u }))).getAttribute("href")).toBe(
        first,
    );
    expect(queryByRole(body, "link", { name: /Authorize VS Code/u })).toBeNull();
    expect(await readFile(join(home, "workspace", ".vscode", "settings.json"), "utf8")).toBe(memberSettings);
    expect(await readFile(join(home, "workspace", "vscode-notes.txt"), "utf8")).toBe("workspace from vscode\n");
    expect(getByText(body, "Your previous conversation and workspace are restored.")).toBeTruthy();
    await app.user.click(getByRole(body, "button", { name: "End session" }));
    await app.eventually(() => getByRole(body, "button", { name: "Start a session" }));
    await app.user.selectOptions(getByRole(body, "combobox", { name: "Open with" }), "morty");
    await app.user.click(getByRole(body, "button", { name: "Start a session" }));
    await app.eventually(() => getByRole(body, "link", { name: /Open chat/u }));
    expect(getByText(body, "Your previous conversation and workspace are restored.")).toBeTruthy();
    expect(await readFile(join(home, "workspace", "vscode-notes.txt"), "utf8")).toBe("workspace from vscode\n");
    for (const job of app.actions.jobs.values()) {
        expect(JSON.stringify(job.diagnostics)).not.toContain("ABCD-EFGH");
        expect(JSON.stringify(job.diagnostics)).not.toContain("private-tunnel-detail");
        expect(JSON.stringify(job.diagnostics)).not.toContain("fake-private-vscode-token");
    }
});

test("Given a ready VS Code session, When the tunnel process exits unexpectedly, Then the member sees a VS Code error and history is still saved", async () => {
    app = await createTestApp();
    const body = document.body;
    await connect(app, tokens.alice);
    await app.user.selectOptions(
        await app.eventually(() => getByRole(body, "combobox", { name: "Open with" })),
        "vscode",
    );
    await app.user.click(getByRole(body, "button", { name: "Start a session" }));
    await app.eventually(() => getByText(body, "ABCD-EFGH"));
    const run = app.github.runs[0];
    if (run === undefined) {
        throw new Error("Expected the VS Code session");
    }
    await app.actions.authorizeVscode(run.id);
    await app.eventually(() => getByRole(body, "link", { name: /Open VS Code/u }));
    await app.actions.failVscode(run.id);
    await app.eventually(() => {
        expect(getByRole(body, "alert").textContent).toContain("VS Code could not connect");
    });
    const job = app.actions.jobs.get(run.id);
    if (job === undefined) {
        throw new Error("Expected the VS Code job");
    }
    await job.done;
    expect(job.diagnostics).toContainEqual({ event: "vscode.failed", stage: "connection", exitCode: 17 });
    expect(JSON.stringify(job.diagnostics)).not.toContain("private-tunnel-detail");
    expect(run.conclusion).toBe("failure");
    expect([...app.actions.cache.keys()]).toContain(`ezshare-history-101-run-${run.id}`);
});
