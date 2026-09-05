/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { Schemas } from '../../../../../base/common/network.js';
import { env as processEnv } from '../../../../../base/common/process.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { XynapseProfileService } from '../../common/xynapseProfileService.js';
import { getXynapseDataDir, XYNAPSE_ACCOUNT_FILE, XYNAPSE_PROFILE_FILE } from '../../common/xynapseProfilePaths.js';

suite('XynapseProfileService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const previousGlobalDir = processEnv['XYNAPSE_GLOBAL_DIR'];

	teardown(() => {
		if (previousGlobalDir === undefined) {
			delete processEnv['XYNAPSE_GLOBAL_DIR'];
		} else {
			processEnv['XYNAPSE_GLOBAL_DIR'] = previousGlobalDir;
		}
	});

	function createServices(dataFolderName: string) {
		// Keep the in-memory provider path directly under its existing root. Real
		// filesystem providers create the normal user-home hierarchy recursively.
		processEnv['XYNAPSE_GLOBAL_DIR'] = `/${dataFolderName}`;
		const logService = new NullLogService();
		const fileService = disposables.add(new FileService(logService));
		disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
		const environmentService = { userRoamingDataHome: URI.file('/xynapse-test-roaming') } as unknown as IEnvironmentService;
		const productService = { dataFolderName } as unknown as IProductService;
		const notificationService = { info: () => undefined } as unknown as INotificationService;
		const dataDir = getXynapseDataDir(environmentService, dataFolderName);
		return { dataDir, environmentService, fileService, logService, notificationService, productService };
	}

	test('stores only credential file names in account metadata', async () => {
		const services = createServices('.xynapse-profile-test-metadata');
		const service = disposables.add(new XynapseProfileService(
			services.fileService,
			services.environmentService,
			services.productService,
			services.logService,
			services.notificationService,
		));

		await service.setProfile(
			{ name: 'Test User', email: 'test@example.invalid' },
			{ keys: { 'config.yaml': 'apiKey: test-secret', '../outside': 'must-not-be-written' } },
		);

		const accountText = (await services.fileService.readFile(joinPath(services.dataDir, XYNAPSE_ACCOUNT_FILE))).value.toString();
		const account = JSON.parse(accountText) as { keys?: unknown; keyFiles?: unknown; isConfigured?: unknown };
		assert.strictEqual(account.keys, undefined);
		assert.deepStrictEqual(account.keyFiles, ['config.yaml']);
		assert.strictEqual(account.isConfigured, true);
		assert.ok(!accountText.includes('test-secret'));
		assert.strictEqual(
			(await services.fileService.readFile(joinPath(services.dataDir, 'config.yaml'))).value.toString(),
			'apiKey: test-secret',
		);
		assert.strictEqual(await services.fileService.exists(joinPath(services.dataDir, 'outside')), false);

		await service.clearProfile();
		assert.strictEqual(await services.fileService.exists(joinPath(services.dataDir, XYNAPSE_ACCOUNT_FILE)), false);
		assert.strictEqual(await services.fileService.exists(joinPath(services.dataDir, 'config.yaml')), false);
		const profile = JSON.parse((await services.fileService.readFile(joinPath(services.dataDir, XYNAPSE_PROFILE_FILE))).value.toString()) as { isConfigured?: unknown };
		assert.strictEqual(profile.isConfigured, false);
	});

	test('migrates legacy account keys to local files and removes the duplicate secrets', async () => {
		const services = createServices('.xynapse-profile-test-legacy');
		await services.fileService.createFolder(services.dataDir);
		await services.fileService.writeFile(
			joinPath(services.dataDir, XYNAPSE_ACCOUNT_FILE),
			VSBuffer.fromString(JSON.stringify({
				name: 'Legacy User',
				email: 'legacy@example.invalid',
				isConfigured: true,
				createdAt: '2026-01-01T00:00:00.000Z',
				keys: { 'config.yaml': 'apiKey: legacy-secret' },
			})),
		);

		const service = disposables.add(new XynapseProfileService(
			services.fileService,
			services.environmentService,
			services.productService,
			services.logService,
			services.notificationService,
		));
		await service.setProfile({ name: 'Legacy User', email: 'legacy@example.invalid' });

		const accountText = (await services.fileService.readFile(joinPath(services.dataDir, XYNAPSE_ACCOUNT_FILE))).value.toString();
		const account = JSON.parse(accountText) as { keys?: unknown; keyFiles?: unknown };
		assert.strictEqual(account.keys, undefined);
		assert.deepStrictEqual(account.keyFiles, ['config.yaml']);
		assert.ok(!accountText.includes('legacy-secret'));
		assert.strictEqual(
			(await services.fileService.readFile(joinPath(services.dataDir, 'config.yaml'))).value.toString(),
			'apiKey: legacy-secret',
		);
	});
});
