/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { ZipFile } from 'yazl';
import buffer from 'gulp-buffer';
import type File from 'vinyl';
import { packageXynapseAssistant } from '../xynapseAssistant.ts';

suite('Pinned Xynapse Assistant', () => {
	let directory: string;
	let vsixPath: string;
	let checksum: string;
	const payload = new Map([
		['package.json', Buffer.from('{\n  "name": "xynapse-assistant", "version": "1.0.0"\n}\n')],
		['out/extension.js', Buffer.from('bvc-portable-v1\n')],
		['out/node_modules/workerpool/dist/worker.js.map', Buffer.from('{ "version": 3 }\n')],
		['bin/xynapse.exe', Buffer.from([0, 1, 128, 255])],
		['.payload-marker', Buffer.from('included')],
	]);

	setup(async () => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xynapse-vsix-test-'));
		vsixPath = path.join(directory, 'assistant.vsix');
		const archive = new ZipFile();
		archive.addBuffer(Buffer.from('VSIX envelope'), 'extension.vsixmanifest');
		for (const [name, contents] of payload) {
			archive.addBuffer(contents, `extension/${name}`);
		}
		archive.end();
		await pipeline(archive.outputStream, fs.createWriteStream(vsixPath));
		checksum = crypto.createHash('sha256').update(fs.readFileSync(vsixPath)).digest('hex');
	});

	teardown(() => {
		fs.rmSync(directory, { recursive: true, force: true });
	});

	test('preserves every payload byte and removes only the envelope and extension prefix', async () => {
		const actual = new Map<string, Buffer>();
		await new Promise<void>((resolve, reject) => {
			packageXynapseAssistant(vsixPath, checksum)
				.pipe(buffer())
				.on('data', (file: File) => {
					assert.ok(Buffer.isBuffer(file.contents));
					actual.set(file.relative.replace(/\\/g, '/'), file.contents);
				})
				.on('error', reject)
				.on('end', resolve);
		});
		assert.deepStrictEqual(actual, new Map([...payload].map(([name, contents]) => [`extensions/xynapse-assistant/${name}`, contents])));
	});

	test('rejects a changed VSIX even when the extension version is unchanged', () => {
		fs.appendFileSync(vsixPath, 'changed');
		assert.throws(() => packageXynapseAssistant(vsixPath, checksum), /checksum mismatch/);
	});

	test('rejects a missing VSIX instead of using a cached extension', () => {
		assert.throws(() => packageXynapseAssistant(path.join(directory, 'missing.vsix'), checksum), /cached extensions are not a fallback/);
	});
});
