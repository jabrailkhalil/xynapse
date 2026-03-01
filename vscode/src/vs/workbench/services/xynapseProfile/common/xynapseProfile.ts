/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Xynapse. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IXynapseProfile {
	name: string;
	email: string;
}

export const IXynapseProfileService = createDecorator<IXynapseProfileService>('xynapseProfileService');

export interface IXynapseProfileService {

	readonly _serviceBrand: undefined;

	readonly onDidChangeProfile: Event<IXynapseProfile | undefined>;

	getProfile(): IXynapseProfile | undefined;
	setProfile(profile: IXynapseProfile): Promise<void>;
	clearProfile(): Promise<void>;
}
