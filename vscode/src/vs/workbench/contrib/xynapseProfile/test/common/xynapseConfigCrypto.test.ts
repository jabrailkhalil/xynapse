/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { decryptConfig, encryptConfig } from '../../common/xynapseConfigCrypto.js';

suite('Xynapse config crypto', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('round trips UTF-8 config content', async () => {
		const plaintext = 'models:\n  - provider: yandex\ncomment: Привет';
		const encrypted = await encryptConfig(plaintext, 'correct horse battery staple');
		assert.strictEqual(await decryptConfig(encrypted, 'correct horse battery staple'), plaintext);
	});

	test('uses fresh salt and IV for each backup', async () => {
		const first = await encryptConfig('same payload', 'correct horse battery staple');
		const second = await encryptConfig('same payload', 'correct horse battery staple');
		assert.notDeepStrictEqual([...first], [...second]);
	});

	test('rejects a wrong password', async () => {
		const encrypted = await encryptConfig('payload', 'correct horse battery staple');
		await assert.rejects(() => decryptConfig(encrypted, 'different password'), /Wrong password or corrupted file/);
	});

	test('detects ciphertext tampering', async () => {
		const encrypted = await encryptConfig('payload', 'correct horse battery staple');
		const tampered = new Uint8Array(encrypted);
		tampered[tampered.length - 1] ^= 0xff;
		await assert.rejects(() => decryptConfig(tampered, 'correct horse battery staple'), /Wrong password or corrupted file/);
	});

	test('rejects short encryption passwords', async () => {
		await assert.rejects(() => encryptConfig('payload', 'short'), /at least 8 characters/);
	});

	test('rejects empty decryption passwords', async () => {
		await assert.rejects(() => decryptConfig(new Uint8Array(64), ''), /cannot be empty/);
	});

	test('rejects data without the Xynapse backup header', async () => {
		await assert.rejects(() => decryptConfig(new Uint8Array(64), 'correct horse battery staple'), /wrong format/);
	});
});
