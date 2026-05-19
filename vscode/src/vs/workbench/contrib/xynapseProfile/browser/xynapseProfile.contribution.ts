/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Xynapse. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IXynapseProfileService } from '../../../services/xynapseProfile/common/xynapseProfile.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { joinPath } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { encryptConfig, decryptConfig } from '../common/xynapseConfigCrypto.js';
import { getXynapseDataDir, XYNAPSE_ACCOUNT_FILE, XYNAPSE_PROFILE_FILE } from '../../../services/xynapseProfile/common/xynapseProfilePaths.js';

// в”Ђв”Ђв”Ђ helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
function xynapseDataDir(nativeEnv: INativeEnvironmentService, product: IProductService): ReturnType<typeof getXynapseDataDir> {
	return getXynapseDataDir(nativeEnv, product.dataFolderName);
}

const EXPORTABLE_FILES = [
	'config.yaml',
	'config.json',
	'.xynapserc.json',
	'sharedConfig.json',
	'.env',
	'config.ts',
	'out/config.js',
	XYNAPSE_PROFILE_FILE,
	XYNAPSE_ACCOUNT_FILE,
] as const;

const KEY_FILE_NAMES = [
	'config.yaml',
	'config.json',
	'.env',
	'.xynapserc.json',
	'sharedConfig.json',
	'config.ts',
	'out/config.js',
] as const;

// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ
//  Profile Management
// в•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђв•ђ

// в”Ђв”Ђв”Ђ Set Up Xynapse Profile в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
registerAction2(class SetUpXynapseProfileAction extends Action2 {
	constructor() {
		super({
			id: 'xynapse.profile.setup',
			title: localize2('xynapseProfileSetup', 'Set Up Xynapse Profile...'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const profileService = accessor.get(IXynapseProfileService);
		const notificationService = accessor.get(INotificationService);

		const rawName = await quickInputService.input({
			prompt: localize('xynapseProfileName', 'Enter your name'),
			placeHolder: localize('xynapseProfileNamePlaceholder', 'Name'),
		});
		const name = rawName?.trim();
		if (!name) { return; }

		const rawEmail = await quickInputService.input({
			prompt: localize('xynapseProfileEmail', 'Enter your email'),
			placeHolder: localize('xynapseProfileEmailPlaceholder', 'Email'),
		});
		const email = rawEmail?.trim();
		if (!email || !email.includes('@')) {
			notificationService.notify({ severity: Severity.Error, message: localize('xynapseProfileInvalidEmail', 'Please enter a valid email address.') });
			return;
		}

		try {
			await profileService.setProfile({ name, email });
			notificationService.notify({ severity: Severity.Info, message: localize('xynapseProfileSetupDone', 'Profile saved: {0}', name) });
		} catch (e) {
			notificationService.notify({ severity: Severity.Error, message: localize('xynapseProfileSetupFailed', 'Failed to set up profile: {0}', String(e)) });
		}
	}
});

// в”Ђв”Ђв”Ђ Edit Xynapse Profile в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
registerAction2(class EditXynapseProfileAction extends Action2 {
	constructor() {
		super({
			id: 'xynapse.profile.edit',
			title: localize2('xynapseProfileEdit', 'Edit Xynapse Profile...'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const profileService = accessor.get(IXynapseProfileService);
		const notificationService = accessor.get(INotificationService);

		const current = profileService.getProfile();

		const rawName = await quickInputService.input({
			prompt: localize('xynapseProfileName', 'Enter your name'),
			placeHolder: localize('xynapseProfileNamePlaceholder', 'Name'),
			value: current?.name,
		});
		const name = rawName?.trim();
		if (!name) { return; }

		const rawEmail = await quickInputService.input({
			prompt: localize('xynapseProfileEmail', 'Enter your email'),
			placeHolder: localize('xynapseProfileEmailPlaceholder', 'Email'),
			value: current?.email,
		});
		const email = rawEmail?.trim();
		if (!email || !email.includes('@')) {
			notificationService.notify({ severity: Severity.Error, message: localize('xynapseProfileInvalidEmail', 'Please enter a valid email address.') });
			return;
		}

		try {
			await profileService.setProfile({ name, email });
			notificationService.notify({ severity: Severity.Info, message: localize('xynapseProfileEditDone', 'Profile updated: {0}', name) });
		} catch (e) {
			notificationService.notify({ severity: Severity.Error, message: localize('xynapseProfileEditFailed', 'Failed to update profile: {0}', String(e)) });
		}
	}
});

// в”Ђв”Ђв”Ђ Clear Xynapse Profile (Sign Out) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
registerAction2(class ClearXynapseProfileAction extends Action2 {
	constructor() {
		super({
			id: 'xynapse.profile.clear',
			title: localize2('xynapseProfileClear', 'Sign Out of Xynapse Profile'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const profileService = accessor.get(IXynapseProfileService);
		const notificationService = accessor.get(INotificationService);
		try {
			await profileService.clearProfile();
			notificationService.notify({ severity: Severity.Info, message: localize('xynapseProfileClearDone', 'Signed out of Xynapse profile.') });
		} catch (e) {
			notificationService.notify({ severity: Severity.Error, message: localize('xynapseProfileClearFailed', 'Failed to sign out: {0}', String(e)) });
		}
	}
});

// Encrypted Config Backup - Export / Import / Git Push / Git Pull
//  All accounts are LOCAL. A single encrypted .enc file stores
//  config.yaml, config.json, profile.json, and account.json (with keys bundle).
//  The user authenticates via built-in GitHub login (github-authentication
//  extension) to push/pull the encrypted backup to/from their git repo.

async function collectBundle(
	fileService: IFileService,
	dataDir: ReturnType<typeof getXynapseDataDir>,
): Promise<Record<string, string> | undefined> {
	const bundle: Record<string, string> = {};

	for (const name of EXPORTABLE_FILES) {
		const uri = joinPath(dataDir, name);
		try {
			if (await fileService.exists(uri)) {
				const content = await fileService.readFile(uri);
				bundle[name] = content.value.toString();
			}
		} catch { /* skip missing */ }
	}

	return Object.keys(bundle).length > 0 ? bundle : undefined;
}

async function promptPassword(quickInputService: IQuickInputService, prompt: string): Promise<string | undefined> {
	return quickInputService.input({
		prompt,
		password: true,
		placeHolder: localize('xynapseConfigPasswordPlaceholder', 'Password'),
	});
}

type XynapseConfigPayload = { version: number; files: Record<string, string> };

async function decryptBundlePayload(data: Uint8Array, passwordInput: string): Promise<XynapseConfigPayload> {
	let lastError: unknown;

	for (const password of passwordInputCandidates(passwordInput)) {
		try {
			const text = await decryptConfig(data, password);
			return JSON.parse(text) as XynapseConfigPayload;
		} catch (e) {
			lastError = e;
		}
	}

	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function passwordInputCandidates(input: string): string[] {
	const result: string[] = [];
	const add = (value: string | undefined) => {
		if (value && !result.includes(value)) {
			result.push(value);
		}
	};

	add(input);
	add(input.trim());

	// Users often paste the whole generated .password.txt helper file.
	// In that case the actual password is the last non-empty line.
	const lines = input.split(/\r?\n/g).map(line => line.trim()).filter(Boolean);
	if (lines.length > 0) {
		add(lines[lines.length - 1]);
	}

	return result;
}

async function restoreBundle(
	fileService: IFileService,
	profileService: IXynapseProfileService,
	dataDir: ReturnType<typeof getXynapseDataDir>,
	bundle: Record<string, string>,
): Promise<number> {
	let count = 0;

	for (const [name, content] of Object.entries(bundle)) {
		if (!(EXPORTABLE_FILES as readonly string[]).includes(name)) { continue; }
		try {
			await fileService.writeFile(joinPath(dataDir, name), VSBuffer.fromString(content));
			count++;
		} catch { /* skip failed writes */ }
	}

	const accountPayload = parseJson<{ name?: unknown; email?: unknown; keys?: unknown }>(bundle[XYNAPSE_ACCOUNT_FILE]);
	const profilePayload = parseJson<{ name?: unknown; email?: unknown }>(bundle[XYNAPSE_PROFILE_FILE]);
	const identity = getProfileIdentity(accountPayload) ?? getProfileIdentity(profilePayload);
	const bundleKeys = collectConfigKeysFromBundle(bundle);
	const accountKeys = coerceStringRecord(accountPayload?.keys);
	const mergedKeys = mergeKeyMaps(bundleKeys, accountKeys);
	const resolvedIdentity = identity ?? getProfileIdentity(profileService.getProfile()) ?? defaultImportedIdentity();

	try {
		await profileService.setProfile(resolvedIdentity, { keys: mergedKeys });
		return count;
	} catch {
		// Fallback to file-level recovery if profile service initialization fails.
		await fileService.writeFile(
			joinPath(dataDir, XYNAPSE_PROFILE_FILE),
			VSBuffer.fromString(JSON.stringify({ ...resolvedIdentity, isConfigured: false }, null, '\t')),
		);
		await fileService.del(joinPath(dataDir, XYNAPSE_ACCOUNT_FILE)).catch(() => undefined);
		await clearRestoredKeyFiles(fileService, dataDir);
	}

	return count;
}

function coerceStringRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}
	const result: Record<string, string> = {};
	for (const [name, fileValue] of Object.entries(value)) {
		if (typeof fileValue === 'string') {
			result[name] = fileValue;
		}
	}
	return result;
}

function parseJson<T>(value: string | undefined): T | undefined {
	if (!value) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed as T;
	} catch {
		return undefined;
	}
}

function hasValidProfileShape(value: { name?: unknown; email?: unknown; isConfigured?: unknown }): value is { name: string; email: string; isConfigured?: boolean } {
	return typeof value.name === 'string' && typeof value.email === 'string';
}

function getProfileIdentity(value: { name?: unknown; email?: unknown } | undefined): { name: string; email: string } | undefined {
	if (value && hasValidProfileShape(value)) {
		return { name: value.name, email: value.email };
	}

	return undefined;
}

function defaultImportedIdentity(): { name: string; email: string } {
	return {
		name: localize('xynapseImportedLocalProfileName', 'Local (Imported)'),
		email: 'imported@local.xynapse',
	};
}

function collectConfigKeysFromBundle(bundle: Record<string, string>): Record<string, string> {
	const keys: Record<string, string> = {};
	for (const fileName of KEY_FILE_NAMES) {
		if (typeof bundle[fileName] === 'string') {
			keys[fileName] = bundle[fileName]!;
		}
	}

	return keys;
}

function mergeKeyMaps(
	base: Record<string, string>,
	extra: Record<string, string>,
): Record<string, string> {
	return { ...base, ...extra };
}

async function clearRestoredKeyFiles(fileService: IFileService, dataDir: ReturnType<typeof getXynapseDataDir>): Promise<void> {
	for (const fileName of KEY_FILE_NAMES) {
		await fileService.del(joinPath(dataDir, fileName)).catch(() => undefined);
	}
}

// в”Ђв”Ђв”Ђ Export Encrypted Config в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
registerAction2(class ExportXynapseConfigAction extends Action2 {
	constructor() {
		super({
			id: 'xynapse.config.export',
			title: localize2('xynapseConfigExport', 'Xynapse: Export Encrypted Config Backup'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const fileDialogService = accessor.get(IFileDialogService);
		const notificationService = accessor.get(INotificationService);
		const fileService = accessor.get(IFileService);
		const nativeEnv = accessor.get(INativeEnvironmentService);
		const product = accessor.get(IProductService);
		const dataDir = xynapseDataDir(nativeEnv, product);

		const bundle = await collectBundle(fileService, dataDir);
		if (!bundle) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('xynapseConfigExportEmpty', 'No Xynapse config files found to export.'),
			});
			return;
		}

		// Prompt password twice
		const password = await promptPassword(quickInputService,
			localize('xynapseConfigExportPassword', 'Enter encryption password for backup'));
		if (!password) { return; }

		const confirm = await promptPassword(quickInputService,
			localize('xynapseConfigExportPasswordConfirm', 'Confirm encryption password'));
		if (!confirm) { return; }

		if (password !== confirm) {
			notificationService.notify({
				severity: Severity.Error,
				message: localize('xynapseConfigExportPasswordMismatch', 'Passwords do not match.'),
			});
			return;
		}

		const payload = JSON.stringify({ version: 1, timestamp: new Date().toISOString(), files: bundle });
		const encrypted = await encryptConfig(payload, password);

		const dest = await fileDialogService.showSaveDialog({
			title: localize('xynapseConfigExportTitle', 'Save Encrypted Config Backup'),
			defaultUri: joinPath(dataDir, 'xynapse-backup.enc'),
			filters: [{ name: 'Xynapse Backup', extensions: ['enc'] }],
		});
		if (!dest) { return; }

		await fileService.writeFile(dest, VSBuffer.wrap(encrypted));

		notificationService.notify({
			severity: Severity.Info,
			message: localize('xynapseConfigExportDone', 'Encrypted backup saved. Add this file to a git repo to sync across machines.'),
		});
	}
});

// в”Ђв”Ђв”Ђ Import Encrypted Config в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
registerAction2(class ImportXynapseConfigAction extends Action2 {
	constructor() {
		super({
			id: 'xynapse.config.import',
			title: localize2('xynapseConfigImport', 'Xynapse: Import Encrypted Config Backup'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const fileDialogService = accessor.get(IFileDialogService);
		const fileService = accessor.get(IFileService);
		const notificationService = accessor.get(INotificationService);
		const commandService = accessor.get(ICommandService);
		const profileService = accessor.get(IXynapseProfileService);
		const nativeEnv = accessor.get(INativeEnvironmentService);
		const product = accessor.get(IProductService);
		const dataDir = xynapseDataDir(nativeEnv, product);

		const sources = await fileDialogService.showOpenDialog({
			title: localize('xynapseConfigImportTitle', 'Open Encrypted Config Backup'),
			canSelectMany: false,
			filters: [{ name: 'Xynapse Backup', extensions: ['enc'] }],
		});
		if (!sources || sources.length === 0) { return; }

		const raw = await fileService.readFile(sources[0]);
		const data = raw.value.buffer.slice(0);

		const password = await promptPassword(quickInputService,
			localize('xynapseConfigImportPassword', 'Enter decryption password'));
		if (!password) { return; }

		let payload: XynapseConfigPayload;
		try {
			payload = await decryptBundlePayload(data, password);
		} catch (e) {
			notificationService.notify({
				severity: Severity.Error,
				message: localize('xynapseConfigImportFailed', 'Decryption failed: {0}', String(e instanceof Error ? e.message : e)),
			});
			return;
		}

		if (payload.version !== 1 || !payload.files) {
			notificationService.notify({
				severity: Severity.Error,
				message: localize('xynapseConfigImportBadVersion', 'Unsupported backup version.'),
			});
			return;
		}

		// Confirm overwrite
		const pick = await quickInputService.pick(
			[
				{ label: localize('yes', 'Yes'), id: 'yes' },
				{ label: localize('no', 'No'), id: 'no' },
			],
			{ placeHolder: localize('xynapseConfigImportConfirm', 'This will overwrite your current config. Continue?') },
		);
		if (!pick || (pick as { id: string }).id !== 'yes') { return; }

		const count = await restoreBundle(fileService, profileService, dataDir, payload.files);

		notificationService.notify({
			severity: Severity.Info,
			message: localize('xynapseConfigImportDone', 'Restored {0} config file(s). Restart to apply.', count),
			actions: {
				primary: [{
					id: 'xynapse.config.import.restart',
					label: localize('xynapseConfigImportRestart', 'Restart Now'),
					tooltip: '',
					class: undefined,
					enabled: true,
					run: () => commandService.executeCommand('workbench.action.reloadWindow'),
				}],
			},
		});
	}
});

// в”Ђв”Ђв”Ђ Push Encrypted Config to Git в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
registerAction2(class PushXynapseConfigToGitAction extends Action2 {
	constructor() {
		super({
			id: 'xynapse.config.pushToGit',
			title: localize2('xynapseConfigPushToGit', 'Xynapse: Push Encrypted Config to Git'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const fileService = accessor.get(IFileService);
		const notificationService = accessor.get(INotificationService);
		const commandService = accessor.get(ICommandService);
		const nativeEnv = accessor.get(INativeEnvironmentService);
		const product = accessor.get(IProductService);
		const dataDir = xynapseDataDir(nativeEnv, product);

		const bundle = await collectBundle(fileService, dataDir);
		if (!bundle) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('xynapseConfigExportEmpty', 'No Xynapse config files found to export.'),
			});
			return;
		}

		// Prompt password
		const password = await promptPassword(quickInputService,
			localize('xynapseConfigGitPassword', 'Enter encryption password for git backup'));
		if (!password) { return; }

		const confirm = await promptPassword(quickInputService,
			localize('xynapseConfigGitPasswordConfirm', 'Confirm encryption password'));
		if (!confirm) { return; }

		if (password !== confirm) {
			notificationService.notify({
				severity: Severity.Error,
				message: localize('xynapseConfigExportPasswordMismatch', 'Passwords do not match.'),
			});
			return;
		}

		// Prompt for git repo URL
		const repoUrl = await quickInputService.input({
			prompt: localize('xynapseConfigGitRepo', 'Enter your git repo URL (e.g. https://github.com/user/my-xynapse-config)'),
			placeHolder: 'https://github.com/user/my-xynapse-config',
		});
		if (!repoUrl) { return; }
		if (!/^(https?:\/\/|git@)[\w.\-\/:@]+$/.test(repoUrl)) {
			notificationService.notify({ severity: Severity.Error, message: localize('xynapseConfigGitInvalidUrl', 'Invalid git URL. Use https:// or git@ format.') });
			return;
		}

		// Encrypt
		const payload = JSON.stringify({ version: 1, timestamp: new Date().toISOString(), files: bundle });
		const encrypted = await encryptConfig(payload, password);

		// Write encrypted file to temp location inside xynapse data dir
		const syncDir = joinPath(dataDir, 'git-sync');
		const encFile = joinPath(syncDir, 'xynapse-backup.enc');

		try {
			// Initialize git repo in sync dir, write file, commit, push
			await fileService.createFolder(syncDir);
			await fileService.writeFile(encFile, VSBuffer.wrap(encrypted));

			// Open terminal and run git commands
			const gitCommands = [
				`cd "${syncDir.fsPath}"`,
				'git init',
				`git remote set-url origin "${repoUrl}" || git remote add origin "${repoUrl}"`,
				'git add xynapse-backup.enc',
				'git commit -m "Xynapse config backup"',
				'git branch -M main',
				'git push -u origin main --force',
			].join(' && ');

			await commandService.executeCommand('workbench.action.terminal.new');
			await commandService.executeCommand('workbench.action.terminal.sendSequence', { text: gitCommands + '\n' });

			notificationService.notify({
				severity: Severity.Info,
				message: localize('xynapseConfigGitPushStarted', 'Git push started in terminal. Check terminal for progress.'),
			});
		} catch (e) {
			notificationService.notify({
				severity: Severity.Error,
				message: localize('xynapseConfigGitPushFailed', 'Failed to push config: {0}', String(e)),
			});
		}
	}
});

// в”Ђв”Ђв”Ђ Pull Encrypted Config from Git в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
registerAction2(class PullXynapseConfigFromGitAction extends Action2 {
	constructor() {
		super({
			id: 'xynapse.config.pullFromGit',
			title: localize2('xynapseConfigPullFromGit', 'Xynapse: Pull Encrypted Config from Git'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const fileService = accessor.get(IFileService);
		const notificationService = accessor.get(INotificationService);
		const commandService = accessor.get(ICommandService);
		const nativeEnv = accessor.get(INativeEnvironmentService);
		const product = accessor.get(IProductService);
		const dataDir = xynapseDataDir(nativeEnv, product);

		// Prompt for git repo URL
		const repoUrl = await quickInputService.input({
			prompt: localize('xynapseConfigGitPullRepo', 'Enter git repo URL with your encrypted config backup'),
			placeHolder: 'https://github.com/user/my-xynapse-config',
		});
		if (!repoUrl) { return; }
		if (!/^(https?:\/\/|git@)[\w.\-\/:@]+$/.test(repoUrl)) {
			notificationService.notify({ severity: Severity.Error, message: localize('xynapseConfigGitInvalidUrl', 'Invalid git URL. Use https:// or git@ format.') });
			return;
		}

		const syncDir = joinPath(dataDir, 'git-sync');

		try {
			// Clone or pull into sync dir
			const exists = await fileService.exists(joinPath(syncDir, '.git'));

			if (exists) {
				// Pull latest
				const gitCommands = [
					`cd "${syncDir.fsPath}"`,
					`git remote set-url origin "${repoUrl}"`,
					'git fetch origin main',
					'git reset --hard origin/main',
				].join(' && ');

				await commandService.executeCommand('workbench.action.terminal.new');
				await commandService.executeCommand('workbench.action.terminal.sendSequence', { text: gitCommands + '\n' });
			} else {
				// Fresh clone - git clone creates the directory itself
				const gitCommands = `git clone "${repoUrl}" "${syncDir.fsPath}" --depth 1`;

				await commandService.executeCommand('workbench.action.terminal.new');
				await commandService.executeCommand('workbench.action.terminal.sendSequence', { text: gitCommands + '\n' });
			}

			// Wait a bit for git to finish, then try to read the file
			// We show instructions since we can't synchronously wait for terminal
			notificationService.notify({
				severity: Severity.Info,
				message: localize('xynapseConfigGitPullWait',
					'Git pull started in terminal. Once complete, run "Xynapse: Import Encrypted Config from Git Sync" to decrypt.'),
			});
		} catch (e) {
			notificationService.notify({
				severity: Severity.Error,
				message: localize('xynapseConfigGitPullFailed', 'Failed to pull config: {0}', String(e)),
			});
		}
	}
});

// в”Ђв”Ђв”Ђ Import from Git Sync folder (decrypt after pull) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
registerAction2(class ImportFromGitSyncAction extends Action2 {
	constructor() {
		super({
			id: 'xynapse.config.importFromGitSync',
			title: localize2('xynapseConfigImportFromGitSync', 'Xynapse: Import Encrypted Config from Git Sync'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const fileService = accessor.get(IFileService);
		const notificationService = accessor.get(INotificationService);
		const commandService = accessor.get(ICommandService);
		const profileService = accessor.get(IXynapseProfileService);
		const nativeEnv = accessor.get(INativeEnvironmentService);
		const product = accessor.get(IProductService);
		const dataDir = xynapseDataDir(nativeEnv, product);

		const encFile = joinPath(dataDir, 'git-sync', 'xynapse-backup.enc');

		if (!(await fileService.exists(encFile))) {
			notificationService.notify({
				severity: Severity.Warning,
				message: localize('xynapseConfigGitSyncNoFile',
					'No backup file found. Run "Xynapse: Pull Encrypted Config from Git" first.'),
			});
			return;
		}

		const raw = await fileService.readFile(encFile);
		const data = raw.value.buffer.slice(0);

		const password = await promptPassword(quickInputService,
			localize('xynapseConfigImportPassword', 'Enter decryption password'));
		if (!password) { return; }

		let payload: XynapseConfigPayload;
		try {
			payload = await decryptBundlePayload(data, password);
		} catch (e) {
			notificationService.notify({
				severity: Severity.Error,
				message: localize('xynapseConfigImportFailed', 'Decryption failed: {0}', String(e instanceof Error ? e.message : e)),
			});
			return;
		}

		if (payload.version !== 1 || !payload.files) {
			notificationService.notify({
				severity: Severity.Error,
				message: localize('xynapseConfigImportBadVersion', 'Unsupported backup version.'),
			});
			return;
		}

		const count = await restoreBundle(fileService, profileService, dataDir, payload.files);

		notificationService.notify({
			severity: Severity.Info,
			message: localize('xynapseConfigImportDone', 'Restored {0} config file(s). Restart to apply.', count),
			actions: {
				primary: [{
					id: 'xynapse.config.importGitSync.restart',
					label: localize('xynapseConfigImportRestart', 'Restart Now'),
					tooltip: '',
					class: undefined,
					enabled: true,
					run: () => commandService.executeCommand('workbench.action.reloadWindow'),
				}],
			},
		});
	}
});
