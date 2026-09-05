/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import crypto from 'crypto';
import fs from 'fs';
import es from 'event-stream';
import filter from 'gulp-filter';
import rename from 'gulp-rename';
import vzip from 'gulp-vinyl-zip';
import File from 'vinyl';
import type { Stream } from 'stream';

/** Packages the pinned VSIX payload without rebuilding, pruning or rewriting its files. */
export function packageXynapseAssistant(vsixPath: string, sha256: string): Stream {
	if (!fs.existsSync(vsixPath)) {
		throw new Error(`Pinned Xynapse Assistant VSIX not found: ${vsixPath}. Supply the release VSIX with XYNAPSE_ASSISTANT_VSIX; cached extensions are not a fallback.`);
	}
	const contents = fs.readFileSync(vsixPath);
	const actual = crypto.createHash('sha256').update(contents).digest('hex');
	if (actual !== sha256) {
		throw new Error(`Pinned Xynapse Assistant VSIX checksum mismatch: expected ${sha256}, actual ${actual}.`);
	}

	// Read the same bytes that were hashed, and omit the VSIX envelope.
	return es.readArray([new File({ path: vsixPath, contents })])
		.pipe(vzip.src())
		.pipe(filter((file: File) => !file.isDirectory() && file.relative.replace(/\\/g, '/').startsWith('extension/'), { dot: true }))
		.pipe(rename(file => {
			file.dirname = `extensions/xynapse-assistant/${file.dirname!.replace(/^extension(?:[\\/]|$)/, '')}`;
		}));
}
