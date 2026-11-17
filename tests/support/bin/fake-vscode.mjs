import { appendFileSync, existsSync, mkdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const state = process.env.VSCODE_CLI_DATA_DIR;
if (typeof state !== "string" || !state.startsWith(`${process.env.HOME}/`)) {
    process.exit(2);
}
mkdirSync(state, { recursive: true });
appendFileSync(
    `${process.env.HOME}.agent-env.jsonl`,
    `${JSON.stringify({
        program: "code",
        command: args.slice(0, 3).join(" "),
        names: Object.keys(process.env).sort(),
    })}\n`,
);
const auth = join(state, "token.json");
const approved = join(state, "approved");
const stopped = join(state, "stopped");
if (args.join(" ") === "tunnel user show") {
    console.log(existsSync(auth) ? "logged in with provider GitHub Account" : "not logged in");
    process.exit(existsSync(auth) ? 0 : 1);
}
if (args.join(" ") === "tunnel kill") {
    writeFileSync(stopped, "stop");
    process.exit(0);
}
if (args.join(" ") === "tunnel user login --provider github") {
    console.error("private-tunnel-detail");
    process.stdout.write("To grant access to the server, please log into https://github.com/login/device and use co");
    process.stdout.write("de ABCD-EFGH \n");
    const check = () => {
        if (existsSync(approved)) {
            writeFileSync(auth, "fake-private-vscode-token");
            observer.close();
            process.exit(0);
        }
    };
    const observer = watch(state, check);
    process.on("SIGTERM", () => {
        observer.close();
        process.exit(0);
    });
    check();
} else if (args[0] === "tunnel" && args.includes("--accept-server-license-terms")) {
    if (!existsSync(auth) || args[args.indexOf("--install-extension") + 1] !== "anthropic.claude-code") {
        process.exit(1);
    }
    const extensionDirectory = args[args.indexOf("--extensions-dir") + 1];
    if (extensionDirectory !== join(process.env.HOME, "vscode", "extensions")) {
        process.exit(2);
    }
    mkdirSync(extensionDirectory, { recursive: true });
    writeFileSync(join(extensionDirectory, "installed-program-cache"), "downloaded extension binaries");
    const downloads = join(process.env.HOME, "vscode", "server", "data", "CachedExtensionVSIXs");
    mkdirSync(downloads, { recursive: true });
    writeFileSync(join(downloads, "package.vsix"), "downloaded extension archive");
    const preferences = join(process.env.HOME, "vscode", "server", "data", "User");
    mkdirSync(preferences, { recursive: true });
    writeFileSync(join(preferences, "settings.json"), '{"editor.fontSize":17}');
    rmSync(stopped, { force: true });
    const name = args[args.indexOf("--name") + 1];
    console.log(`Open this link in your browser https://vscode.dev/tunnel/${name}/`);
    const observer = watch(state, () => {
        if (existsSync(join(state, "failed"))) {
            console.error("private-tunnel-detail");
            observer.close();
            process.exit(17);
        }
        if (existsSync(stopped)) {
            observer.close();
            process.exit(0);
        }
    });
    process.on("SIGTERM", () => {
        observer.close();
        process.exit(0);
    });
} else {
    process.exit(2);
}
