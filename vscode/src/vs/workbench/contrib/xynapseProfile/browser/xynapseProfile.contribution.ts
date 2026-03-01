/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Xynapse. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IXynapseProfileService } from '../../../services/xynapseProfile/common/xynapseProfile.js';

// Command: Set Up Xynapse Profile
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
		if (!name) {
			return;
		}

		const email = await quickInputService.input({
			prompt: localize('xynapseProfileEmail', 'Enter your email'),
			placeHolder: localize('xynapseProfileEmailPlaceholder', 'Email'),
		});
		if (!email) {
			return;
		}

		await profileService.setProfile({ name, email });
	}
});

// Command: Edit Xynapse Profile
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
		if (!name) {
			return;
		}

		const email = await quickInputService.input({
			prompt: localize('xynapseProfileEmail', 'Enter your email'),
			placeHolder: localize('xynapseProfileEmailPlaceholder', 'Email'),
			value: current?.email,
		});
		if (!email) {
			return;
		}

		await profileService.setProfile({ name, email });
	}
});

// Command: Clear Xynapse Profile (Sign Out)
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
