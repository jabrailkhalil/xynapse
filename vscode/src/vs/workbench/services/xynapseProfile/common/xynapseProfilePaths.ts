/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Xynapse. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { joinPath } from '../../../../base/common/resources.js';
import { env as processEnv } from '../../../../base/common/process.js';

export const XYNAPSE_PROFILE_FILE = 'profile.json';
export const XYNAPSE_ACCOUNT_FILE = 'account.json';

export function getXynapseDataDir(environmentService: INativeEnvironmentService, dataFolderName: string): URI {
	const portablePath = processEnv['VSCODE_PORTABLE'];
	if (portablePath) {
		return joinPath(URI.file(portablePath), dataFolderName);
	}

	return joinPath(environmentService.userHome, dataFolderName);
}
