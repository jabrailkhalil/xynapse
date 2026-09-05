/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { basename } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IXynapseAccount, IXynapseProfile, IXynapseProfileInput, IXynapseProfileService } from './xynapseProfile.js';
import { getXynapseDataDir, XYNAPSE_ACCOUNT_FILE, XYNAPSE_PROFILE_FILE } from './xynapseProfilePaths.js';

type LoadedXynapseAccount = IXynapseAccount & {
	/** Accepted only to migrate account.json files written before 1.108.0. */
	legacyKeys: Record<string, string>;
};

export class XynapseProfileService extends Disposable implements IXynapseProfileService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeProfile = this._register(new Emitter<IXynapseProfile | undefined>());
	readonly onDidChangeProfile = this._onDidChangeProfile.event;

	private readonly profileFolder: URI;
	private readonly profileResource: URI;
	private readonly accountResource: URI;
	private cachedProfile: IXynapseProfile | undefined;
	private readonly _loaded: Promise<void>;
	private readonly defaultProfileName: string;
	private readonly defaultProfileEmail: string;
	private static readonly KEY_FILES = ['config.yaml', 'config.json', '.env', '.xynapserc.json', 'sharedConfig.json', 'config.ts', 'out/config.js'] as const;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IProductService productService: IProductService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this.profileFolder = getXynapseDataDir(environmentService, productService.dataFolderName);
		this.profileResource = joinPath(this.profileFolder, XYNAPSE_PROFILE_FILE);
		this.accountResource = joinPath(this.profileFolder, XYNAPSE_ACCOUNT_FILE);

		const home = basename(dirname(this.profileFolder).fsPath || dirname(this.profileFolder).path || 'user') || 'user';
		this.defaultProfileName = `Local (${home})`;
		this.defaultProfileEmail = `${home.toLowerCase()}@local.xynapse`;

		this._loaded = this.loadProfile();
	}

	getProfile(): IXynapseProfile | undefined {
		return this.cachedProfile;
	}

	async setProfile(profile: IXynapseProfileInput, options: { keys?: Record<string, string> } = {}): Promise<void> {
		await this._loaded;
		try {
			await this.ensureDataFolder();
			const keys = this.pickKeyFiles(options.keys ?? await this.collectKeys());
			const hasKeyMaterial = this.hasKeyMaterial(keys);
			const payload: IXynapseProfile = { ...profile, isConfigured: hasKeyMaterial };
			await this.fileService.writeFile(this.profileResource, VSBuffer.fromString(JSON.stringify(payload, null, '\t')));

			if (hasKeyMaterial) {
				const account: IXynapseAccount = {
					name: payload.name,
					email: payload.email,
					isConfigured: true,
					createdAt: new Date().toISOString(),
					keyFiles: Object.keys(keys).sort(),
				};
				await this.fileService.writeFile(this.accountResource, VSBuffer.fromString(JSON.stringify(account, null, '\t')));
				await this.materializeKeyFilesFromKeys(keys);
			} else {
				await this.deleteFileIfExists(this.accountResource);
				await this.clearKeyFiles();
			}

			this.cachedProfile = payload;
			this._onDidChangeProfile.fire(this.cachedProfile);
		} catch (e) {
			this.logService.error('[Xynapse] Failed to save profile:', e);
			throw e;
		}
	}

	async clearProfile(): Promise<void> {
		await this._loaded;
		try {
			await this.ensureDataFolder();
			await this.deleteFileIfExists(this.profileResource);
			await this.deleteFileIfExists(this.accountResource);
			await this.clearKeyFiles();

			const local = this.createFallbackProfile();
			await this.fileService.writeFile(this.profileResource, VSBuffer.fromString(JSON.stringify(local, null, '\t')));
			this.cachedProfile = local;
			this._onDidChangeProfile.fire(this.cachedProfile);
		} catch (e) {
			this.logService.error('[Xynapse] Failed to clear profile:', e);
			throw e;
		}
	}

	private createFallbackProfile(): IXynapseProfile {
		return {
			name: this.defaultProfileName,
			email: this.defaultProfileEmail,
			isConfigured: false,
		};
	}

	private async loadProfile(): Promise<void> {
		try {
			await this.ensureDataFolder();

			const account = await this.loadAccount();
			const localKeys = this.pickKeyFiles(await this.collectKeys());
			const accountKeys = account ? { ...account.legacyKeys, ...localKeys } : localKeys;
			if (account && this.hasKeyMaterial(accountKeys)) {
				const normalizedKeys = this.pickKeyFiles(accountKeys);
				const normalizedProfile: IXynapseProfile = {
					name: account.name,
					email: account.email,
					isConfigured: true,
				};
				const normalizedAccount: IXynapseAccount = {
					name: account.name,
					email: account.email,
					isConfigured: true,
					createdAt: account.createdAt,
					keyFiles: Object.keys(normalizedKeys).sort(),
				};

				await this.fileService.writeFile(this.profileResource, VSBuffer.fromString(JSON.stringify(normalizedProfile, null, '\t')));
				await this.fileService.writeFile(this.accountResource, VSBuffer.fromString(JSON.stringify(normalizedAccount, null, '\t')));
				await this.materializeKeyFilesFromKeys(normalizedKeys);
				this.cachedProfile = normalizedProfile;
				return;
			}

			if (account) {
				await this.deleteFileIfExists(this.accountResource);
				await this.clearKeyFiles();
			}

			if (this.hasKeyMaterial(localKeys)) {
				const existingProfile = await this.loadProfileFile();
				const migratedProfile: IXynapseProfile = {
					name: existingProfile?.name ?? this.defaultProfileName,
					email: existingProfile?.email ?? this.defaultProfileEmail,
					isConfigured: true,
				};
				const migratedAccount: IXynapseAccount = {
					name: migratedProfile.name,
					email: migratedProfile.email,
					isConfigured: true,
					createdAt: new Date().toISOString(),
					keyFiles: Object.keys(localKeys).sort(),
				};

				await this.fileService.writeFile(this.profileResource, VSBuffer.fromString(JSON.stringify(migratedProfile, null, '\t')));
				await this.fileService.writeFile(this.accountResource, VSBuffer.fromString(JSON.stringify(migratedAccount, null, '\t')));
				await this.materializeKeyFilesFromKeys(localKeys);
				this.cachedProfile = migratedProfile;
				this.notificationService.info(
					`Existing local key files were migrated to a Xynapse account (${migratedProfile.name}).`,
				);
				return;
			}

			const profile = await this.loadProfileFile();
			if (profile) {
				const localProfile = {
					name: profile.name,
					email: profile.email,
					isConfigured: false,
				} satisfies IXynapseProfile;
				await this.fileService.writeFile(this.profileResource, VSBuffer.fromString(JSON.stringify(localProfile, null, '\t')));
				await this.deleteFileIfExists(this.accountResource);
				await this.clearKeyFiles();
				this.cachedProfile = {
					name: localProfile.name,
					email: localProfile.email,
					isConfigured: false,
				};
				return;
			}

			const localProfile = this.createFallbackProfile();
			await this.fileService.writeFile(this.profileResource, VSBuffer.fromString(JSON.stringify(localProfile, null, '\t')));
			this.cachedProfile = localProfile;
			this.notificationService.info(
				`Local Xynapse profile created (${localProfile.name}). Configure credentials before creating an encrypted backup.`,
			);
		} catch (e) {
			this.logService.error('[Xynapse] Failed to load profile:', e);
		}
	}

	private async loadProfileFile(): Promise<IXynapseProfile | undefined> {
		const exists = await this.fileService.exists(this.profileResource);
		if (!exists) {
			return undefined;
		}

		const content = await this.fileService.readFile(this.profileResource);
		try {
			const data = JSON.parse(content.value.toString());
			if (
				data &&
				typeof data.name === 'string' &&
				typeof data.email === 'string'
			) {
				return {
					name: data.name,
					email: data.email,
					isConfigured: data.isConfigured === true,
				};
			}
		} catch {
			this.logService.error('[Xynapse] profile.json contains invalid JSON');
		}

		return undefined;
	}

	private async loadAccount(): Promise<LoadedXynapseAccount | undefined> {
		const exists = await this.fileService.exists(this.accountResource);
		if (!exists) {
			return undefined;
		}

		const content = await this.fileService.readFile(this.accountResource);
		try {
			const data = JSON.parse(content.value.toString());
			if (!data || typeof data.name !== 'string' || typeof data.email !== 'string') {
				return undefined;
			}

			return {
				name: data.name,
				email: data.email,
				isConfigured: data.isConfigured === true,
				createdAt: typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString(),
				keyFiles: this.coerceKeyFileNames(data.keyFiles),
				legacyKeys: this.coerceKeys(data.keys),
			};
		} catch {
			this.logService.error('[Xynapse] account.json contains invalid JSON');
		}

		return undefined;
	}

	private coerceKeys(value: unknown): Record<string, string> {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return {};
		}

		const keys = this.pickKeyFiles(value as Record<string, unknown>);
		return keys;
	}

	private coerceKeyFileNames(value: unknown): string[] {
		if (!Array.isArray(value)) {
			return [];
		}

		const allowed = new Set<string>(XynapseProfileService.KEY_FILES);
		return [...new Set(value.filter((name): name is string => typeof name === 'string' && allowed.has(name)))].sort();
	}

	private pickKeyFiles(value: Record<string, unknown>): Record<string, string> {
		const allowed = new Set<string>(XynapseProfileService.KEY_FILES);
		const keys: Record<string, string> = {};
		for (const [name, fileValue] of Object.entries(value)) {
			if (typeof fileValue === 'string' && allowed.has(name)) {
				keys[name] = fileValue;
			}
		}
		return keys;
	}

	private async ensureDataFolder(): Promise<void> {
		const parent = dirname(this.profileResource);
		const parentExists = await this.fileService.exists(parent);
		if (!parentExists) {
			await this.fileService.createFolder(parent);
		}
	}

	private async collectKeys(): Promise<Record<string, string>> {
		const keys: Record<string, string> = {};

		for (const fileName of XynapseProfileService.KEY_FILES) {
			const keyFile = joinPath(this.profileFolder, fileName);
			try {
				if (await this.fileService.exists(keyFile)) {
					const content = await this.fileService.readFile(keyFile);
					keys[fileName] = content.value.toString();
				}
			} catch (e) {
				this.logService.error(`[Xynapse] Failed to collect ${fileName}:`, e);
			}
		}

		return keys;
	}

	private hasKeyMaterial(keys: Record<string, string>): boolean {
		return Object.values(keys).some(value => value.trim().length > 0);
	}

	private async materializeKeyFilesFromKeys(keys: Record<string, string>): Promise<void> {
		try {
			await this.ensureDataFolder();
			await this.clearKeyFiles();
			for (const fileName of XynapseProfileService.KEY_FILES) {
				const fileContent = keys[fileName];
				if (typeof fileContent !== 'string') {
					continue;
				}
				const keyResource = joinPath(this.profileFolder, fileName);
				const keyParent = dirname(keyResource);
				if (!(await this.fileService.exists(keyParent))) {
					await this.fileService.createFolder(keyParent);
				}
				await this.fileService.writeFile(keyResource, VSBuffer.fromString(fileContent));
			}
		} catch (e) {
			this.logService.error('[Xynapse] Failed to materialize key files from account keys:', e);
		}
	}

	private async clearKeyFiles(): Promise<void> {
		for (const fileName of XynapseProfileService.KEY_FILES) {
			await this.deleteFileIfExists(joinPath(this.profileFolder, fileName));
		}
	}

	private async deleteFileIfExists(resource: URI): Promise<void> {
		if (await this.fileService.exists(resource)) {
			await this.fileService.del(resource);
		}
	}
}

registerSingleton(IXynapseProfileService, XynapseProfileService, InstantiationType.Delayed);
