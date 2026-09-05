/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IXynapseProfile {
	name: string;
	email: string;
	isConfigured: boolean;
}

export interface IXynapseProfileInput {
	name: string;
	email: string;
}

export interface IXynapseAccount {
	name: string;
	email: string;
	isConfigured: boolean;
	/** Names of local credential files. Secret contents are never stored here. */
	keyFiles: string[];
	createdAt: string;
}

export const IXynapseProfileService = createDecorator<IXynapseProfileService>('xynapseProfileService');

export interface IXynapseProfileService {

	readonly _serviceBrand: undefined;

	readonly onDidChangeProfile: Event<IXynapseProfile | undefined>;

	getProfile(): IXynapseProfile | undefined;
	setProfile(profile: IXynapseProfileInput, options?: { keys?: Record<string, string> }): Promise<void>;
	clearProfile(): Promise<void>;
}
