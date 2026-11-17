import type { SharedAccount } from "../../shared/accounts.ts";
import { type ErrorCode, toAppError } from "../../shared/errors.ts";
import type { MemberContext } from "./session-protocol.ts";

export type AccountCatalog =
    | { readonly kind: "loading" }
    | { readonly kind: "ready"; readonly items: readonly SharedAccount[] }
    | { readonly kind: "failed"; readonly code: ErrorCode };

export async function readAccounts(member: MemberContext, signal: AbortSignal): Promise<AccountCatalog> {
    try {
        return { kind: "ready", items: await member.github.sharedAccounts(member.repository.name, signal) };
    } catch (cause) {
        if (signal.aborted) {
            throw cause;
        }
        return { kind: "failed", code: toAppError(cause).code };
    }
}
