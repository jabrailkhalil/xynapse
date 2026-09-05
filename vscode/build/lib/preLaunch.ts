/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rootDir = path.resolve(import.meta.dirname, '..', '..');

function runProcess(command: string, args: ReadonlyArray<string> = []) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd: rootDir, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
		child.on('exit', err => !err ? resolve() : process.exit(err ?? 1));
		child.on('error', reject);
	});
}

async function exists(subdir: string) {
	try {
		await fs.stat(path.join(rootDir, subdir));
		return true;
	} catch {
		return false;
	}
}

async function ensureNodeModules() {
	if (!(await exists('node_modules'))) {
		await runProcess(npm, ['ci']);
	}
}

async function getElectron() {
	await runProcess(npm, ['run', 'electron']);
}

async function ensureCompiled() {
	if (!(await exists('out'))) {
		await runProcess(npm, ['run', 'gulp', 'transpile-client-esbuild']);
	}
}

async function ensureRipgrepBinary() {
	const rgBinary = path.join('node_modules', '@vscode', 'ripgrep', 'bin', `rg${process.platform === 'win32' ? '.exe' : ''}`);
	if (!(await exists(rgBinary))) {
		console.log(`Missing ${rgBinary}, running ripgrep postinstall...`);
		await runProcess(process.execPath, [path.join('node_modules', '@vscode', 'ripgrep', 'lib', 'postinstall.js')]);
	}
}

async function ensurePolicyWatcherBinary() {
	const policyWatcherBinary = path.join('node_modules', '@vscode', 'policy-watcher', 'build', 'Release', 'vscode-policy-watcher.node');
	if (!(await exists(policyWatcherBinary))) {
		console.log(`Missing ${policyWatcherBinary}, rebuilding @vscode/policy-watcher...`);
		await runProcess(npm, ['rebuild', '@vscode/policy-watcher']);
	}
}

async function ensureRuntimeDependencies() {
	await ensureRipgrepBinary();
	await ensurePolicyWatcherBinary();
}

async function main() {
	await ensureNodeModules();
	await ensureRuntimeDependencies();
	await getElectron();
	await ensureCompiled();

	// Built-in extension sync frequently hits GitHub API limits in local dev.
	// Keep startup deterministic unless explicitly enabled.
	if (process.env['VSCODE_SYNC_BUILTIN_EXTENSIONS'] === '1') {
		// Can't require this until after dependencies are installed
		const { getBuiltInExtensions } = await import('./builtInExtensions.ts');
		try {
			await getBuiltInExtensions();
		} catch (err) {
			console.warn('Skipping built-in extensions sync due to error:', err);
		}
	}
}

if (import.meta.main) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
