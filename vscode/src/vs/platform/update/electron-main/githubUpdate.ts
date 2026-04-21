/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from 'semver';
import { IProductConfiguration } from '../../../base/common/product.js';
import { UpdateType } from '../common/update.js';

export interface IGitHubReleaseAsset {
	readonly name: string;
	readonly browser_download_url: string;
	readonly content_type?: string;
}

export interface IGitHubRelease {
	readonly tag_name: string;
	readonly name?: string;
	readonly html_url?: string;
	readonly assets: readonly IGitHubReleaseAsset[];
}

export type GitHubUpdateAssetKind = 'archive' | 'user' | 'system';

const VERSION_PATTERN = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/;
const ARCHIVE_EXTENSIONS = ['.zip', '.7z', '.tar.gz', '.tgz'];
const ARCH_TOKENS: Record<string, string[]> = {
	x64: ['x64', 'amd64', 'x86_64'],
	arm64: ['arm64', 'aarch64']
};

export function hasGitHubUpdateConfig(productService: IProductConfiguration): productService is IProductConfiguration & { githubUpdate: NonNullable<IProductConfiguration['githubUpdate']> } {
	return Boolean(productService.githubUpdate?.owner && productService.githubUpdate?.repo);
}

export function getGitHubUpdateUrl(productService: IProductConfiguration): string | undefined {
	if (!hasGitHubUpdateConfig(productService)) {
		return undefined;
	}

	return `https://api.github.com/repos/${productService.githubUpdate.owner}/${productService.githubUpdate.repo}/releases/latest`;
}

export function extractVersion(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const match = VERSION_PATTERN.exec(value);
	if (!match) {
		return undefined;
	}

	return semver.valid(match[0]) ?? undefined;
}

export function getGitHubReleaseVersion(release: IGitHubRelease): string | undefined {
	return extractVersion(release.tag_name) ?? extractVersion(release.name);
}

export function isGitHubReleaseNewer(currentVersion: string, release: IGitHubRelease): boolean {
	const normalizedCurrentVersion = extractVersion(currentVersion);
	const releaseVersion = getGitHubReleaseVersion(release);

	if (!normalizedCurrentVersion || !releaseVersion) {
		return false;
	}

	return semver.gt(releaseVersion, normalizedCurrentVersion);
}

export function getGitHubAssetKind(productService: IProductConfiguration, updateType: UpdateType): GitHubUpdateAssetKind {
	if (updateType === UpdateType.Archive) {
		return 'archive';
	}

	return productService.target === 'user' ? 'user' : 'system';
}

export function getConfiguredGitHubAssetName(
	productService: IProductConfiguration,
	updateType: UpdateType,
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch
): string | undefined {
	if (!hasGitHubUpdateConfig(productService)) {
		return undefined;
	}

	const kind = getGitHubAssetKind(productService, updateType);
	const candidates = [
		`${platform}-${arch}-${kind}`,
		`${platform}-${arch}`,
		`${platform}-${kind}`,
		platform,
		'default'
	];

	for (const candidate of candidates) {
		const assetName = productService.githubUpdate.assetNames?.[candidate];
		if (assetName) {
			return assetName;
		}
	}

	return productService.githubUpdate.assetName;
}

export function selectGitHubReleaseAsset(
	productService: IProductConfiguration,
	release: IGitHubRelease,
	updateType: UpdateType,
	platform: NodeJS.Platform = process.platform,
	arch: string = process.arch
): IGitHubReleaseAsset | undefined {
	const configuredAssetName = getConfiguredGitHubAssetName(productService, updateType, platform, arch);
	if (configuredAssetName) {
		const configuredAsset = release.assets.find(asset => equalsIgnoreCase(asset.name, configuredAssetName));
		if (configuredAsset) {
			return configuredAsset;
		}
	}

	const assets = release.assets.filter(asset => isSupportedAsset(asset.name, updateType));
	if (assets.length === 0) {
		return undefined;
	}

	if (assets.length === 1) {
		return assets[0];
	}

	const kind = getGitHubAssetKind(productService, updateType);
	const productTokens = [
		productService.nameShort,
		productService.applicationName,
		productService.win32RegValueName
	].filter((value): value is string => Boolean(value)).map(tokenize);
	const archTokens = ARCH_TOKENS[arch] ?? [arch.toLowerCase()];

	let bestAsset: IGitHubReleaseAsset | undefined;
	let bestScore = Number.NEGATIVE_INFINITY;

	for (const asset of assets) {
		const score = scoreAsset(asset.name, kind, productTokens, archTokens);
		if (score > bestScore) {
			bestScore = score;
			bestAsset = asset;
		}
	}

	return bestScore > 0 ? bestAsset : undefined;
}

function isSupportedAsset(assetName: string, updateType: UpdateType): boolean {
	const normalizedAssetName = assetName.toLowerCase();
	if (updateType === UpdateType.Archive) {
		return ARCHIVE_EXTENSIONS.some(extension => normalizedAssetName.endsWith(extension));
	}

	return normalizedAssetName.endsWith('.exe');
}

function scoreAsset(assetName: string, kind: GitHubUpdateAssetKind, productTokens: string[], archTokens: string[]): number {
	const normalizedAssetName = assetName.toLowerCase();
	let score = 0;

	if (normalizedAssetName.includes('source code')) {
		return Number.NEGATIVE_INFINITY;
	}

	if (productTokens.some(token => normalizedAssetName.includes(token))) {
		score += 40;
	}

	if (kind === 'archive') {
		if (normalizedAssetName.includes('archive') || normalizedAssetName.includes('portable')) {
			score += 20;
		}
		if (normalizedAssetName.includes('setup') || normalizedAssetName.includes('installer')) {
			score -= 25;
		}
	} else {
		if (normalizedAssetName.includes('setup') || normalizedAssetName.includes('installer')) {
			score += 25;
		}
		if (normalizedAssetName.includes('archive') || normalizedAssetName.includes('portable')) {
			score -= 25;
		}
		if (kind === 'user') {
			if (normalizedAssetName.includes('user')) {
				score += 20;
			}
			if (normalizedAssetName.includes('system')) {
				score -= 15;
			}
		} else {
			if (normalizedAssetName.includes('system')) {
				score += 10;
			}
			if (normalizedAssetName.includes('user')) {
				score -= 20;
			}
		}
	}

	if (archTokens.some(token => normalizedAssetName.includes(token))) {
		score += 15;
	}

	return score;
}

function tokenize(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function equalsIgnoreCase(left: string, right: string): boolean {
	return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0 || left.toLowerCase() === right.toLowerCase();
}
