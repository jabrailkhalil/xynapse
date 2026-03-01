/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Xynapse. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IXynapseProfile, IXynapseProfileService } from './xynapseProfile.js';

export class XynapseProfileService extends Disposable implements IXynapseProfileService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeProfile = this._register(new Emitter<IXynapseProfile | undefined>());
	readonly onDidChangeProfile = this._onDidChangeProfile.event;

	private cachedProfile: IXynapseProfile | undefined;
	private readonly profileResource: URI;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@IProductService productService: IProductService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.profileResource = joinPath(environmentService.userHome, productService.dataFolderName, 'profile.json');
		this.loadProfile();
	}

	private async loadProfile(): Promise<void> {
		try {
			const exists = await this.fileService.exists(this.profileResource);
			if (exists) {
				const content = await this.fileService.readFile(this.profileResource);
				const data = JSON.parse(content.value.toString());
				if (data && typeof data.name === 'string' && typeof data.email === 'string') {
					this.cachedProfile = { name: data.name, email: data.email };
				}
			}
		} catch (e) {
			this.logService.error('[Xynapse] Failed to load profile:', e);
		}
	}

	getProfile(): IXynapseProfile | undefined {
		return this.cachedProfile;
	}

	async setProfile(profile: IXynapseProfile): Promise<void> {
		try {
			const content = JSON.stringify({ name: profile.name, email: profile.email }, null, '\t');
			await this.fileService.writeFile(this.profileResource, VSBuffer.fromString(content));
			this.cachedProfile = { ...profile };
			this._onDidChangeProfile.fire(this.cachedProfile);
		} catch (e) {
			this.logService.error('[Xynapse] Failed to save profile:', e);
			throw e;
		}
	}

	async clearProfile(): Promise<void> {
		try {
			const exists = await this.fileService.exists(this.profileResource);
			if (exists) {
				await this.fileService.del(this.profileResource);
			}
			this.cachedProfile = undefined;
			this._onDidChangeProfile.fire(undefined);
		} catch (e) {
			this.logService.error('[Xynapse] Failed to clear profile:', e);
			throw e;
		}
	}
}

registerSingleton(IXynapseProfileService, XynapseProfileService, InstantiationType.Delayed);
