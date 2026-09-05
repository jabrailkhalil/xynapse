/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { joinPath } from '../../../../base/common/resources.js';
import { env as processEnv } from '../../../../base/common/process.js';

export const XYNAPSE_PROFILE_FILE = 'profile.json';
export const XYNAPSE_ACCOUNT_FILE = 'account.json';

export function getXynapseDataDir(environmentService: IEnvironmentService, dataFolderName: string): URI {
	const explicitPath = processEnv['XYNAPSE_GLOBAL_DIR'];
	if (explicitPath) {
		return URI.file(explicitPath);
	}

	const portablePath = processEnv['VSCODE_PORTABLE'];
	if (portablePath) {
		return joinPath(URI.file(portablePath), dataFolderName);
	}

	const userHome = processEnv['USERPROFILE'] || processEnv['HOME'];
	if (userHome) {
		return joinPath(URI.file(userHome), dataFolderName);
	}

	// Web hosts do not expose a native home directory. Keep the profile in the
	// product's roaming-data namespace instead of guessing a filesystem path.
	return joinPath(environmentService.userRoamingDataHome, dataFolderName);
}
