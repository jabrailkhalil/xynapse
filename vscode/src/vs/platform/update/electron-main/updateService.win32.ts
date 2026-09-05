/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { mkdir, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { app } from 'electron';
import { timeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { memoize } from '../../../base/common/decorators.js';
import { hash } from '../../../base/common/hash.js';
import * as path from '../../../base/common/path.js';
import { URI } from '../../../base/common/uri.js';
import { checksum } from '../../../base/node/crypto.js';
import * as pfs from '../../../base/node/pfs.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { IFileService } from '../../files/common/files.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService, isSuccess } from '../../request/common/request.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, DisablementReason, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { AbstractUpdateService, createUpdateURL, UpdateErrorClassification } from './abstractUpdateService.js';
import { getGitHubReleaseVersion, getGitHubUpdateUrl, hasGitHubUpdateConfig, IGitHubRelease, isGitHubReleaseNewer, selectGitHubReleaseAsset } from './githubUpdate.js';

async function pollUntil(fn: () => boolean, millis = 1000): Promise<void> {
	while (!fn()) {
		await timeout(millis);
	}
}

interface IAvailableUpdate {
	packagePath: string;
	updateFilePath?: string;
}

let _updateType: UpdateType | undefined = undefined;
function getUpdateType(): UpdateType {
	if (typeof _updateType === 'undefined') {
		_updateType = existsSync(path.join(path.dirname(process.execPath), 'unins000.exe'))
			? UpdateType.Setup
			: UpdateType.Archive;
	}

	return _updateType;
}

export class Win32UpdateService extends AbstractUpdateService implements IRelaunchHandler {

	private availableUpdate: IAvailableUpdate | undefined;

	@memoize
	get cachePath(): Promise<string> {
		const result = path.join(tmpdir(), `vscode-${this.productService.quality}-${this.productService.target}-${process.arch}`);
		return mkdir(result, { recursive: true }).then(() => result);
	}

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@INativeHostMainService private readonly nativeHostMainService: INativeHostMainService,
		@IProductService productService: IProductService
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService);

		lifecycleMainService.setRelaunchHandler(this);
	}

	handleRelaunch(options?: IRelaunchOptions): boolean {
		if (options?.addArgs || options?.removeArgs) {
			return false; // we cannot apply an update and restart with different args
		}

		if (this.state.type !== StateType.Ready || !this.availableUpdate) {
			return false; // we only handle the relaunch when we have a pending update
		}

		this.logService.trace('update#handleRelaunch(): running raw#quitAndInstall()');
		this.doQuitAndInstall();

		return true;
	}

	protected override async initialize(): Promise<void> {
		// The Electron `appUpdate` path exists only in Microsoft's patched build.
		// Xynapse uses the independent GitHub Releases updater below, which manages
		// its own cache, so calling app.setPath('appUpdate', ...) on stock Electron
		// would throw and abort updater initialization.
		if (this.environmentMainService.isBuilt && !hasGitHubUpdateConfig(this.productService)) {
			const cachePath = await this.cachePath;
			app.setPath('appUpdate', cachePath);
			try {
				await unlink(path.join(cachePath, 'session-ending.flag'));
			} catch { }
		}

		if (this.productService.target === 'user' && await this.nativeHostMainService.isAdmin(undefined)) {
			this.setState(State.Disabled(DisablementReason.RunningAsAdmin));
			this.logService.info('update#ctor - updates are disabled due to running as Admin in user setup');
			return;
		}

		await super.initialize();
	}

	protected override async postInitialize(): Promise<void> {
		if (this.productService.quality !== 'insider') {
			return;
		}
		// Check for pending update from previous session
		// This can happen if the app is quit right after the update has been
		// downloaded and before the update has been applied.
		const exePath = app.getPath('exe');
		const exeDir = path.dirname(exePath);
		const updatingVersionPath = path.join(exeDir, 'updating_version');
		if (await pfs.Promises.exists(updatingVersionPath)) {
			try {
				const updatingVersion = (await readFile(updatingVersionPath, 'utf8')).trim();
				this.logService.info(`update#doCheckForUpdates - application was updating to version ${updatingVersion}`);
				const updatePackagePath = await this.getUpdatePackagePath(updatingVersion);
				if (await pfs.Promises.exists(updatePackagePath)) {
					await this._applySpecificUpdate(updatePackagePath);
					this.logService.info(`update#doCheckForUpdates - successfully applied update to version ${updatingVersion}`);
				}
			} catch (e) {
				this.logService.error(`update#doCheckForUpdates - could not read ${updatingVersionPath}`, e);
			} finally {
				// updatingVersionPath will be deleted by inno setup.
			}
		} else {
			const fastUpdatesEnabled = this.configurationService.getValue('update.enableWindowsBackgroundUpdates');
			// GC for background updates in system setup happens via inno_setup since it requires
			// elevated permissions.
			if (fastUpdatesEnabled && this.productService.target === 'user' && this.productService.commit) {
				const versionedResourcesFolder = this.productService.commit.substring(0, 10);
				const innoUpdater = path.join(exeDir, versionedResourcesFolder, 'tools', 'inno_updater.exe');
				await new Promise<void>(resolve => {
					const child = spawn(innoUpdater, ['--gc', exePath, versionedResourcesFolder], {
						stdio: ['ignore', 'ignore', 'ignore'],
						windowsHide: true,
						timeout: 2 * 60 * 1000
					});
					child.once('exit', () => resolve());
				});
			}
		}
	}

	protected override hasUpdateConfiguration(): boolean {
		return hasGitHubUpdateConfig(this.productService) || super.hasUpdateConfiguration();
	}

	protected buildUpdateFeedUrl(quality: string): string | undefined {
		const githubUpdateUrl = getGitHubUpdateUrl(this.productService);
		if (githubUpdateUrl) {
			return githubUpdateUrl;
		}

		let platform = `win32-${process.arch}`;

		if (getUpdateType() === UpdateType.Archive) {
			platform += '-archive';
		} else if (this.productService.target === 'user') {
			platform += '-user';
		}

		return createUpdateURL(platform, quality, this.productService);
	}

	protected doCheckForUpdates(explicit: boolean): void {
		if (!this.url) {
			return;
		}

		if (hasGitHubUpdateConfig(this.productService)) {
			this.doCheckForUpdatesFromGitHub(explicit);
			return;
		}

		const url = explicit ? this.url : `${this.url}?bg=true`;
		this.setState(State.CheckingForUpdates(explicit));

		this.requestService.request({ url }, CancellationToken.None)
			.then<IUpdate | null>(asJson)
			.then(update => {
				const updateType = getUpdateType();

				if (!update || !update.url || !update.version || !update.productVersion) {
					this.setState(State.Idle(updateType));
					return Promise.resolve(null);
				}

				if (updateType === UpdateType.Archive) {
					this.setState(State.AvailableForDownload(update));
					return Promise.resolve(null);
				}

				this.setState(State.Downloading);
				return this.stageDownloadedUpdate(update);
			})
			.then(undefined, err => {
				this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
				this.logService.error(err);

				// only show message when explicitly checking for updates
				const message: string | undefined = explicit ? (err.message || err) : undefined;
				this.setState(State.Idle(getUpdateType(), message));
			});
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		if (state.update.url) {
			this.nativeHostMainService.openExternal(undefined, state.update.url);
		}
		this.setState(State.Idle(getUpdateType()));
	}

	override async isLatestVersion(): Promise<boolean | undefined> {
		if (!this.url) {
			return undefined;
		}

		if (this.configurationService.getValue('update.mode') === 'none') {
			return false;
		}

		if (!hasGitHubUpdateConfig(this.productService)) {
			return super.isLatestVersion();
		}

		try {
			const release = await this.fetchLatestGitHubRelease();
			return !isGitHubReleaseNewer(this.productService.version, release);
		} catch (error) {
			this.logService.error('update#isLatestVersion(): failed to check GitHub releases');
			this.logService.error(error);
			return undefined;
		}
	}

	private doCheckForUpdatesFromGitHub(explicit: boolean): void {
		const updateType = getUpdateType();
		this.setState(State.CheckingForUpdates(explicit));

		this.fetchLatestGitHubRelease()
			.then(release => {
				const releaseVersion = getGitHubReleaseVersion(release);
				if (!releaseVersion) {
					const message = explicit ? `Latest GitHub release '${release.tag_name}' does not contain a semantic version.` : undefined;
					this.setState(State.Idle(updateType, message));
					return Promise.resolve(undefined);
				}

				if (!isGitHubReleaseNewer(this.productService.version, release)) {
					this.setState(State.Idle(updateType));
					return Promise.resolve(undefined);
				}

				const asset = selectGitHubReleaseAsset(this.productService, release, updateType);
				if (!asset) {
					throw new Error(`Latest GitHub release '${release.tag_name}' does not contain a compatible Windows ${updateType === UpdateType.Archive ? 'archive' : 'setup'} asset.`);
				}

				const update: IUpdate = {
					version: releaseVersion,
					productVersion: releaseVersion,
					url: asset.browser_download_url
				};

				if (updateType === UpdateType.Archive) {
					this.setState(State.AvailableForDownload(update));
					return Promise.resolve(undefined);
				}

				this.setState(State.Downloading);
				return this.stageDownloadedUpdate(update);
			})
			.then(undefined, err => {
				this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
				this.logService.error(err);

				const message: string | undefined = explicit ? (err.message || err) : undefined;
				this.setState(State.Idle(updateType, message));
			});
	}

	private async fetchLatestGitHubRelease(): Promise<IGitHubRelease> {
		if (!this.url || !hasGitHubUpdateConfig(this.productService)) {
			throw new Error('GitHub updates are not configured.');
		}

		const context = await this.requestService.request({
			url: this.url,
			headers: {
				'Accept': 'application/vnd.github+json',
				'User-Agent': `${this.productService.nameShort} ${this.productService.version}`
			}
		}, CancellationToken.None);

		if (context.res.statusCode === 404) {
			throw new Error(`No published GitHub releases found for ${this.productService.githubUpdate.owner}/${this.productService.githubUpdate.repo}.`);
		}

		if (!isSuccess(context)) {
			throw new Error(`GitHub returned ${context.res.statusCode} while checking for updates.`);
		}

		const release = await asJson<IGitHubRelease>(context);
		if (!release) {
			throw new Error('GitHub returned an empty release response.');
		}

		return release;
	}

	private async stageDownloadedUpdate(update: IUpdate): Promise<void> {
		const packagePath = await this.downloadUpdatePackage(update);
		this.availableUpdate = { packagePath };
		this.setState(State.Downloaded(update));

		const fastUpdatesEnabled = this.configurationService.getValue('update.enableWindowsBackgroundUpdates');
		if (fastUpdatesEnabled) {
			if (this.productService.target === 'user') {
				this.doApplyUpdate();
			}
		} else {
			this.setState(State.Ready(update));
		}
	}

	private async downloadUpdatePackage(update: IUpdate): Promise<string> {
		if (!update.url) {
			throw new Error('Update is missing a download URL.');
		}

		await this.cleanup(update.version);
		const updatePackagePath = await this.getUpdatePackagePath(update.version);
		if (await pfs.Promises.exists(updatePackagePath)) {
			return updatePackagePath;
		}

		const downloadPath = `${updatePackagePath}.tmp`;
		const context = await this.requestService.request({ url: update.url }, CancellationToken.None);
		await this.fileService.writeFile(URI.file(downloadPath), context.stream);
		if (update.sha256hash) {
			await checksum(downloadPath, update.sha256hash);
		}
		await pfs.Promises.rename(downloadPath, updatePackagePath, false /* no retry */);

		return updatePackagePath;
	}

	private async getUpdatePackagePath(version: string): Promise<string> {
		const cachePath = await this.cachePath;
		return path.join(cachePath, `CodeSetup-${this.productService.quality}-${version}.exe`);
	}

	private async cleanup(exceptVersion: string | null = null): Promise<void> {
		const filter = exceptVersion ? (one: string) => !(new RegExp(`${this.productService.quality}-${exceptVersion}\\.exe$`).test(one)) : () => true;

		const cachePath = await this.cachePath;
		const versions = await pfs.Promises.readdir(cachePath);

		const promises = versions.filter(filter).map(async one => {
			try {
				await unlink(path.join(cachePath, one));
			} catch (err) {
				// ignore
			}
		});

		await Promise.all(promises);
	}

	protected override async doApplyUpdate(): Promise<void> {
		if (this.state.type !== StateType.Downloaded) {
			return Promise.resolve(undefined);
		}

		if (!this.availableUpdate) {
			return Promise.resolve(undefined);
		}

		const update = this.state.update;
		this.setState(State.Updating(update));

		const cachePath = await this.cachePath;
		const sessionEndFlagPath = path.join(cachePath, 'session-ending.flag');

		this.availableUpdate.updateFilePath = path.join(cachePath, `CodeSetup-${this.productService.quality}-${update.version}.flag`);

		await pfs.Promises.writeFile(this.availableUpdate.updateFilePath, 'flag');
		const child = spawn(this.availableUpdate.packagePath, ['/verysilent', '/log', `/update="${this.availableUpdate.updateFilePath}"`, `/sessionend="${sessionEndFlagPath}"`, '/nocloseapplications', '/mergetasks=runcode,!desktopicon,!quicklaunchicon'], {
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore'],
			windowsVerbatimArguments: true
		});

		child.once('exit', () => {
			this.availableUpdate = undefined;
			this.setState(State.Idle(getUpdateType()));
		});

		const readyMutexName = `${this.productService.win32MutexName}-ready`;
		const mutex = await import('@vscode/windows-mutex');

		// poll for mutex-ready
		pollUntil(() => mutex.isActive(readyMutexName))
			.then(() => this.setState(State.Ready(update)));
	}

	protected override doQuitAndInstall(): void {
		if (this.state.type !== StateType.Ready || !this.availableUpdate) {
			return;
		}

		this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');

		if (this.availableUpdate.updateFilePath) {
			unlinkSync(this.availableUpdate.updateFilePath);
		} else {
			spawn(this.availableUpdate.packagePath, ['/silent', '/log', '/mergetasks=runcode,!desktopicon,!quicklaunchicon'], {
				detached: true,
				stdio: ['ignore', 'ignore', 'ignore']
			});
		}
	}

	protected override getUpdateType(): UpdateType {
		return getUpdateType();
	}

	override async _applySpecificUpdate(packagePath: string): Promise<void> {
		if (this.state.type !== StateType.Idle) {
			return;
		}

		const fastUpdatesEnabled = this.configurationService.getValue('update.enableWindowsBackgroundUpdates');
		const update: IUpdate = { version: 'unknown', productVersion: 'unknown' };

		this.setState(State.Downloading);
		this.availableUpdate = { packagePath };
		this.setState(State.Downloaded(update));

		if (fastUpdatesEnabled) {
			if (this.productService.target === 'user') {
				this.doApplyUpdate();
			}
		} else {
			this.setState(State.Ready(update));
		}
	}
}
