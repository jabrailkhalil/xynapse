/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IProductConfiguration } from '../../../../base/common/product.js';
import { UpdateType } from '../../common/update.js';
import { extractVersion, getConfiguredGitHubAssetName, getGitHubReleaseVersion, isGitHubReleaseNewer, selectGitHubReleaseAsset } from '../../electron-main/githubUpdate.js';

suite('GitHubUpdate', () => {
	const baseProduct = {
		version: '1.108.0',
		nameShort: 'Xynapse',
		nameLong: 'Xynapse IDE',
		applicationName: 'xynapse',
		dataFolderName: '.xynapse',
		urlProtocol: 'xynapse',
		serverApplicationName: 'xynapse-server',
		defaultChatAgent: {} as IProductConfiguration['defaultChatAgent'],
		extensionProperties: {},
		target: 'user',
		githubUpdate: {
			owner: 'jabrailkhalil',
			repo: 'xynapse'
		}
	} as IProductConfiguration;

	test('extractVersion should parse semver from tags', () => {
		assert.strictEqual(extractVersion('v1.109.2'), '1.109.2');
		assert.strictEqual(extractVersion('release-1.109.2-beta.1'), '1.109.2-beta.1');
		assert.strictEqual(extractVersion('latest'), undefined);
	});

	test('getGitHubReleaseVersion prefers tag name', () => {
		assert.strictEqual(getGitHubReleaseVersion({ tag_name: 'v1.109.0', name: 'Release 1.108.9', assets: [] }), '1.109.0');
	});

	test('isGitHubReleaseNewer compares normalized semver', () => {
		assert.strictEqual(isGitHubReleaseNewer('1.108.0', { tag_name: 'v1.108.1', assets: [] }), true);
		assert.strictEqual(isGitHubReleaseNewer('1.108.0', { tag_name: 'v1.108.0', assets: [] }), false);
	});

	test('getConfiguredGitHubAssetName resolves the most specific key first', () => {
		const product = {
			...baseProduct,
			githubUpdate: {
				owner: 'jabrailkhalil',
				repo: 'xynapse',
				assetNames: {
					'win32': 'generic.exe',
					'win32-x64-user': 'specific.exe'
				}
			}
		} as IProductConfiguration;

		assert.strictEqual(getConfiguredGitHubAssetName(product, UpdateType.Setup, 'win32', 'x64'), 'specific.exe');
	});

	test('selectGitHubReleaseAsset should prefer configured asset names', () => {
		const product = {
			...baseProduct,
			githubUpdate: {
				owner: 'jabrailkhalil',
				repo: 'xynapse',
				assetNames: {
					'win32-x64-user': 'XynapseUserSetup-x64.exe'
				}
			}
		} as IProductConfiguration;

		const release = {
			tag_name: 'v1.108.1',
			assets: [
				{ name: 'XynapseSetup-x64.exe', browser_download_url: 'https://example.com/system.exe' },
				{ name: 'XynapseUserSetup-x64.exe', browser_download_url: 'https://example.com/user.exe' }
			]
		};

		assert.strictEqual(selectGitHubReleaseAsset(product, release, UpdateType.Setup, 'win32', 'x64')?.name, 'XynapseUserSetup-x64.exe');
	});

	test('selectGitHubReleaseAsset should score user installers higher for user targets', () => {
		const release = {
			tag_name: 'v1.108.1',
			assets: [
				{ name: 'XynapseSetup-x64.exe', browser_download_url: 'https://example.com/system.exe' },
				{ name: 'XynapseUserSetup-x64.exe', browser_download_url: 'https://example.com/user.exe' }
			]
		};

		assert.strictEqual(selectGitHubReleaseAsset(baseProduct, release, UpdateType.Setup, 'win32', 'x64')?.name, 'XynapseUserSetup-x64.exe');
	});

	test('selectGitHubReleaseAsset should filter archive assets for archive installs', () => {
		const release = {
			tag_name: 'v1.108.1',
			assets: [
				{ name: 'XynapseSetup-x64.exe', browser_download_url: 'https://example.com/setup.exe' },
				{ name: 'XynapsePortable-x64.zip', browser_download_url: 'https://example.com/portable.zip' }
			]
		};

		assert.strictEqual(selectGitHubReleaseAsset(baseProduct, release, UpdateType.Archive, 'win32', 'x64')?.name, 'XynapsePortable-x64.zip');
	});
});
