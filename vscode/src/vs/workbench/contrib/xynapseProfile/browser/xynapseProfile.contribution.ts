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
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { encryptConfig, decryptConfig } from '../common/xynapseConfigCrypto.js';
import { env as processEnv } from '../../../../base/common/process.js';

// ─── helpers ────────────────────────────────────────────────────────────────
function xynapseDataDir(accessor: ServicesAccessor): URI {
	// Portable mode: store config inside portable data directory
	const portablePath = processEnv['VSCODE_PORTABLE'];
	if (portablePath) {
		return joinPath(URI.file(portablePath), '.xynapse');
	}
	const nativeEnv = accessor.get(INativeEnvironmentService);
	const product = accessor.get(IProductService);
	return joinPath(nativeEnv.userHome, product.dataFolderName);
}

const EXPORTABLE_FILES = ['config.yaml', 'config.json', 'profile.json'];

// ═══════════════════════════════════════════════════════════════════════════
//  Profile Management
// ═══════════════════════════════════════════════════════════════════════════

// ─── Set Up Xynapse Profile ─────────────────────────────────────────────────
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

		const name = await quickInputService.input({
			prompt: localize('xynapseProfileName', 'Enter your name'),
			placeHolder: localize('xynapseProfileNamePlaceholder', 'Name'),
		});
		if (!name) { return; }

		const email = await quickInputService.input({
			prompt: localize('xynapseProfileEmail', 'Enter your email'),
			placeHolder: localize('xynapseProfileEmailPlaceholder', 'Email'),
		});
		if (!email) { return; }

		await profileService.setProfile({ name, email });
	}
});

// ─── Edit Xynapse Profile ───────────────────────────────────────────────────
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

		const current = profileService.getProfile();

		const name = await quickInputService.input({
			prompt: localize('xynapseProfileName', 'Enter your name'),
			placeHolder: localize('xynapseProfileNamePlaceholder', 'Name'),
			value: current?.name,
		});
		if (!name) { return; }

		const email = await quickInputService.input({
			prompt: localize('xynapseProfileEmail', 'Enter your email'),
			placeHolder: localize('xynapseProfileEmailPlaceholder', 'Email'),
			value: current?.email,
		});
		if (!email) { return; }

		await profileService.setProfile({ name, email });
	}
});

// ─── Clear Xynapse Profile (Sign Out) ──────────────────────────────────────
registerAction2(class ClearXynapseProfileAction extends Action2 {
	constructor() {
		super({
			id: 'xynapse.profile.clear',
			title: localize2('xynapseProfileClear', 'Sign Out of Xynapse Profile'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const profileService = accessor.get(IXynapseProfileService);
		await profileService.clearProfile();
	}
});

// ═══════════════════════════════════════════════════════════════════════════
//  Encrypted Config Backup — Export / Import / Git Push / Git Pull
//  All accounts are LOCAL. A single encrypted .enc file stores
//  config.yaml, config.json, and profile.json (with API keys).
//  The user authenticates via built-in GitHub login (github-authentication
//  extension) to push/pull the encrypted backup to/from their git repo.
// ═══════════════════════════════════════════════════════════════════════════

async function collectBundle(accessor: ServicesAccessor): Promise<Record<string, string> | undefined> {
	const fileService = accessor.get(IFileService);
	const dataDir = xynapseDataDir(accessor);
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

async function restoreBundle(
	accessor: ServicesAccessor,
	bundle: Record<string, string>,
): Promise<number> {
	const fileService = accessor.get(IFileService);
	const profileService = accessor.get(IXynapseProfileService);
	const dataDir = xynapseDataDir(accessor);
	let count = 0;

	for (const [name, content] of Object.entries(bundle)) {
		if (!EXPORTABLE_FILES.includes(name)) { continue; }
		await fileService.writeFile(joinPath(dataDir, name), VSBuffer.fromString(content));
		count++;
	}

	// Reload profile if it was in the bundle
	if (bundle['profile.json']) {
		try {
			const p = JSON.parse(bundle['profile.json']);
			if (p.name && p.email) {
				await profileService.setProfile({ name: p.name, email: p.email });
			}
		} catch { /* skip */ }
	}

	return count;
}

// ─── Export Encrypted Config ────────────────────────────────────────────────
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

		const bundle = await collectBundle(accessor);
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

		const dataDir = xynapseDataDir(accessor);
		const dest = await fileDialogService.showSaveDialog({
			title: localize('xynapseConfigExportTitle', 'Save Encrypted Config Backup'),
			defaultUri: joinPath(dataDir, 'xynapse-backup.enc'),
			filters: [{ name: 'Xynapse Backup', extensions: ['enc'] }],
		});
		if (!dest) { return; }

		const fileService = accessor.get(IFileService);
		await fileService.writeFile(dest, VSBuffer.wrap(encrypted));

		notificationService.notify({
			severity: Severity.Info,
			message: localize('xynapseConfigExportDone', 'Encrypted backup saved. Add this file to a git repo to sync across machines.'),
		});
	}
});

// ─── Import Encrypted Config ────────────────────────────────────────────────
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

		const sources = await fileDialogService.showOpenDialog({
			title: localize('xynapseConfigImportTitle', 'Open Encrypted Config Backup'),
			canSelectMany: false,
			filters: [{ name: 'Xynapse Backup', extensions: ['enc'] }],
		});
		if (!sources || sources.length === 0) { return; }

		const raw = await fileService.readFile(sources[0]);
		const data = new Uint8Array(raw.value.buffer);

		const password = await promptPassword(quickInputService,
			localize('xynapseConfigImportPassword', 'Enter decryption password'));
		if (!password) { return; }

		let payload: { version: number; files: Record<string, string> };
		try {
			const text = await decryptConfig(data, password);
			payload = JSON.parse(text);
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

		const count = await restoreBundle(accessor, payload.files);

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

// ─── Push Encrypted Config to Git ───────────────────────────────────────────
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

		const bundle = await collectBundle(accessor);
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

		// Encrypt
		const payload = JSON.stringify({ version: 1, timestamp: new Date().toISOString(), files: bundle });
		const encrypted = await encryptConfig(payload, password);

		// Write encrypted file to temp location inside xynapse data dir
		const dataDir = xynapseDataDir(accessor);
		const syncDir = joinPath(dataDir, 'git-sync');
		const encFile = joinPath(syncDir, 'xynapse-backup.enc');

		try {
			// Initialize git repo in sync dir, write file, commit, push
			await fileService.createFolder(syncDir);
			await fileService.writeFile(encFile, VSBuffer.wrap(encrypted));

			// Use the terminal to run git commands — the user has git auth via github-authentication
			const commandService = accessor.get(ICommandService);

			// Open terminal and run git commands
			const gitCommands = [
				`cd "${syncDir.fsPath}"`,
				'git init',
				`git remote add origin ${repoUrl} 2>/dev/null || git remote set-url origin ${repoUrl}`,
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

// ─── Pull Encrypted Config from Git ─────────────────────────────────────────
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

		// Prompt for git repo URL
		const repoUrl = await quickInputService.input({
			prompt: localize('xynapseConfigGitPullRepo', 'Enter git repo URL with your encrypted config backup'),
			placeHolder: 'https://github.com/user/my-xynapse-config',
		});
		if (!repoUrl) { return; }

		const dataDir = xynapseDataDir(accessor);
		const syncDir = joinPath(dataDir, 'git-sync');

		try {
			// Clone or pull into sync dir
			const exists = await fileService.exists(joinPath(syncDir, '.git'));

			if (exists) {
				// Pull latest
				const gitCommands = [
					`cd "${syncDir.fsPath}"`,
					`git remote set-url origin ${repoUrl}`,
					'git fetch origin main',
					'git reset --hard origin/main',
				].join(' && ');

				await commandService.executeCommand('workbench.action.terminal.new');
				await commandService.executeCommand('workbench.action.terminal.sendSequence', { text: gitCommands + '\n' });
			} else {
				// Fresh clone
				await fileService.createFolder(syncDir);
				const gitCommands = `git clone ${repoUrl} "${syncDir.fsPath}" --depth 1`;

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

// ─── Import from Git Sync folder (decrypt after pull) ──────────────────────
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

		const dataDir = xynapseDataDir(accessor);
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
		const data = new Uint8Array(raw.value.buffer);

		const password = await promptPassword(quickInputService,
			localize('xynapseConfigImportPassword', 'Enter decryption password'));
		if (!password) { return; }

		let payload: { version: number; files: Record<string, string> };
		try {
			const text = await decryptConfig(data, password);
			payload = JSON.parse(text);
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

		const count = await restoreBundle(accessor, payload.files);

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
