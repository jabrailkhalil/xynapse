/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Xynapse. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { basename } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IXynapseAccount, IXynapseProfile, IXynapseProfileInput, IXynapseProfileService } from './xynapseProfile.js';
import { getXynapseDataDir, XYNAPSE_ACCOUNT_FILE, XYNAPSE_PROFILE_FILE } from './xynapseProfilePaths.js';

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

	constructor(
		@IFileService private readonly fileService: IFileService,
		environmentService: INativeEnvironmentService,
		@IProductService productService: IProductService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this.profileFolder = getXynapseDataDir(environmentService, productService.dataFolderName);
		this.profileResource = joinPath(this.profileFolder, XYNAPSE_PROFILE_FILE);
		this.accountResource = joinPath(this.profileFolder, XYNAPSE_ACCOUNT_FILE);

		const home = basename(environmentService.userHome.fsPath || environmentService.userHome.path || 'user') || 'user';
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
			const payload: IXynapseProfile = { ...profile, isConfigured: true };
			const account: IXynapseAccount = {
				name: payload.name,
				email: payload.email,
				isConfigured: true,
				createdAt: new Date().toISOString(),
				keys: options.keys || await this.collectKeys(),
			};

			await this.fileService.writeFile(this.profileResource, VSBuffer.fromString(JSON.stringify(payload, null, '\t')));
			await this.fileService.writeFile(this.accountResource, VSBuffer.fromString(JSON.stringify(account, null, '\t')));
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
			const profileExists = await this.fileService.exists(this.profileResource);
			if (profileExists) {
				await this.fileService.del(this.profileResource);
			}
			const accountExists = await this.fileService.exists(this.accountResource);
			if (accountExists) {
				await this.fileService.del(this.accountResource);
			}

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
			if (account) {
				this.cachedProfile = {
					name: account.name,
					email: account.email,
					isConfigured: account.isConfigured,
				};
				return;
			}

			const profile = await this.loadProfileFile();
			if (profile) {
				this.cachedProfile = { ...profile, isConfigured: false };
				return;
			}

			const localProfile = this.createFallbackProfile();
			await this.fileService.writeFile(this.profileResource, VSBuffer.fromString(JSON.stringify(localProfile, null, '\t')));
			this.cachedProfile = localProfile;
			this.notificationService.info(
				`Local Xynapse profile created (${localProfile.name}). Configure an account to enable encrypted sync.`,
			);
		} catch (e) {
			this.logService.error('[Xynapse] Failed to load profile:', e);
		}
	}

	private async loadProfileFile(): Promise<Omit<IXynapseProfile, 'isConfigured'> | undefined> {
		const exists = await this.fileService.exists(this.profileResource);
		if (!exists) {
			return undefined;
		}

		const content = await this.fileService.readFile(this.profileResource);
		try {
			const data = JSON.parse(content.value.toString());
			if (data && typeof data.name === 'string' && typeof data.email === 'string') {
				return { name: data.name, email: data.email };
			}
		} catch {
			this.logService.error('[Xynapse] profile.json contains invalid JSON');
		}

		return undefined;
	}

	private async loadAccount(): Promise<IXynapseAccount | undefined> {
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
				keys: this.coerceKeys(data.keys),
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

		const keys: Record<string, string> = {};
		for (const [name, fileValue] of Object.entries(value)) {
			if (typeof fileValue === 'string') {
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

		for (const fileName of ['config.yaml', 'config.json'] as const) {
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
}

registerSingleton(IXynapseProfileService, XynapseProfileService, InstantiationType.Delayed);
