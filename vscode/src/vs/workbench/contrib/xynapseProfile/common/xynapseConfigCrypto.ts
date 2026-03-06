/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Xynapse. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * AES-256-GCM encryption/decryption for Xynapse config bundles.
 * Uses Web Crypto API (available in both browser and Node.js contexts).
 * Key is derived from a user-supplied password via PBKDF2.
 */

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 600_000;
const BUNDLE_MAGIC = new TextEncoder().encode('XYNCFG1'); // 7 bytes

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
	const raw = new TextEncoder().encode(password);
	const keyMaterial = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

export async function encryptConfig(plaintext: string, password: string): Promise<Uint8Array> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const key = await deriveKey(password, salt);
	const encoded = new TextEncoder().encode(plaintext);
	const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

	// [7 magic][16 salt][12 iv][ciphertext+tag]
	const result = new Uint8Array(BUNDLE_MAGIC.length + SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
	result.set(BUNDLE_MAGIC, 0);
	result.set(salt, BUNDLE_MAGIC.length);
	result.set(iv, BUNDLE_MAGIC.length + SALT_LENGTH);
	result.set(new Uint8Array(ciphertext), BUNDLE_MAGIC.length + SALT_LENGTH + IV_LENGTH);
	return result;
}

export async function decryptConfig(data: Uint8Array, password: string): Promise<string> {
	// Validate magic
	for (let i = 0; i < BUNDLE_MAGIC.length; i++) {
		if (data[i] !== BUNDLE_MAGIC[i]) {
			throw new Error('Invalid backup file (wrong format)');
		}
	}

	const offset = BUNDLE_MAGIC.length;
	const salt = data.slice(offset, offset + SALT_LENGTH);
	const iv = data.slice(offset + SALT_LENGTH, offset + SALT_LENGTH + IV_LENGTH);
	const ciphertext = data.slice(offset + SALT_LENGTH + IV_LENGTH);

	const key = await deriveKey(password, salt);

	try {
		const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
		return new TextDecoder().decode(plainBuffer);
	} catch {
		throw new Error('Wrong password or corrupted file');
	}
}
