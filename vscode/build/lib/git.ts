/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

/**
 * Returns the sha1 commit version of a repository or undefined in case of failure.
 */
export function getVersion(repo: string): string | undefined {
	// Xynapse keeps the Code OSS tree in a monorepo subdirectory. Ask Git first
	// so normal repositories, subdirectories and linked worktrees all resolve to
	// the actual checkout commit. Source archives still fall back to the original
	// direct .git reader below (or BUILD_SOURCEVERSION in getVersion.ts).
	try {
		const version = execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: repo,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			windowsHide: true
		}).trim();
		if (/^[0-9a-f]{40}$/i.test(version)) {
			return version;
		}
	} catch {
		// Fall through to the filesystem-only implementation.
	}

	const git = path.join(repo, '.git');
	const headPath = path.join(git, 'HEAD');
	let head: string;

	try {
		head = fs.readFileSync(headPath, 'utf8').trim();
	} catch (e) {
		return undefined;
	}

	if (/^[0-9a-f]{40}$/i.test(head)) {
		return head;
	}

	const refMatch = /^ref: (.*)$/.exec(head);

	if (!refMatch) {
		return undefined;
	}

	const ref = refMatch[1];
	const refPath = path.join(git, ref);

	try {
		return fs.readFileSync(refPath, 'utf8').trim();
	} catch (e) {
		// noop
	}

	const packedRefsPath = path.join(git, 'packed-refs');
	let refsRaw: string;

	try {
		refsRaw = fs.readFileSync(packedRefsPath, 'utf8').trim();
	} catch (e) {
		return undefined;
	}

	const refsRegex = /^([0-9a-f]{40})\s+(.+)$/gm;
	let refsMatch: RegExpExecArray | null;
	const refs: { [ref: string]: string } = {};

	while (refsMatch = refsRegex.exec(refsRaw)) {
		refs[refsMatch[2]] = refsMatch[1];
	}

	return refs[ref];
}
