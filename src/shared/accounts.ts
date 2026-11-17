import * as v from "valibot";
import { AppError } from "./errors.ts";

export const LEGACY_ACCOUNT = "legacy";
export const LEGACY_SECRET = "EZSHARE_CLAUDE_TOKEN";
const PREFIX = "EZSHARE_CLAUDE_ACCOUNT_";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export interface SharedAccount {
    readonly id: string;
    /** Null identifies the original, unnamed account. */
    readonly name: string | null;
    readonly updatedAt: string;
}

function encode(bytes: Uint8Array): string {
    let bits = 0;
    let value = 0;
    let result = "";
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            result += ALPHABET.charAt((value >>> bits) & 31);
        }
    }
    if (bits > 0) {
        result += ALPHABET.charAt((value << (5 - bits)) & 31);
    }
    return result;
}

function normalizedName(value: string): string {
    const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (name.length === 0 || /[\p{Cc}\p{Cf}]/u.test(name) || new TextEncoder().encode(name).length > 36) {
        throw new AppError("account_name_invalid");
    }
    return name;
}

/** A random suffix keeps simultaneous additions from overwriting another account's secret. */
export function newAccountId(name: string): string {
    return `${encode(new TextEncoder().encode(normalizedName(name)))}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}

/** Account labels are reversible metadata in a secret's name; credential values stay sealed. */
export function accountName(id: string): string | null {
    if (id === LEGACY_ACCOUNT) {
        return null;
    }
    if (!/^[A-Z2-7]{2,58}_[A-F0-9]{16}$/u.test(id)) {
        throw new AppError("invalid_input");
    }
    const label = id.split("_")[0] ?? "";
    const bytes: number[] = [];
    let bits = 0;
    let value = 0;
    for (const character of label) {
        value = (value << 5) | ALPHABET.indexOf(character);
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((value >>> bits) & 255);
        }
    }
    try {
        const name = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
        if (normalizedName(name) !== name || encode(new TextEncoder().encode(name)) !== label) {
            throw new AppError("invalid_input");
        }
        return name;
    } catch (cause) {
        throw new AppError("invalid_input", { cause });
    }
}

export const accountIdSchema = v.pipe(
    v.string(),
    v.maxLength(75),
    v.check((id) => {
        try {
            accountName(id);
            return true;
        } catch {
            return false;
        }
    }),
);

export function accountSecret(id: string): string {
    accountName(id);
    return id === LEGACY_ACCOUNT ? LEGACY_SECRET : `${PREFIX}${id}`;
}

export function accountFromSecret(name: string, updatedAt: string): SharedAccount | null {
    const id = name === LEGACY_SECRET ? LEGACY_ACCOUNT : name.startsWith(PREFIX) ? name.slice(PREFIX.length) : null;
    if (id === null || !v.is(accountIdSchema, id)) {
        return null;
    }
    return { id, name: accountName(id), updatedAt };
}
