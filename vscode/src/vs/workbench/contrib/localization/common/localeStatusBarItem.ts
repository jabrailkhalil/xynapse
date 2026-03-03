/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { getNLSLanguage } from '../../../../nls.js';
import { StatusbarAlignment, IStatusbarService, IStatusbarEntryAccessor } from '../../../services/statusbar/browser/statusbar.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ConfigureDisplayLanguageAction } from './localizationsActions.js';

export class LocaleStatusBarContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.localeStatusBar';

	private readonly pickerElement = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
	) {
		super();

		const locale = getNLSLanguage() || 'en';
		const label = locale.toUpperCase();
		const name = 'Display Language';
		const text = `$(globe) ${label}`;
		const ariaLabel = `Display Language: ${label}`;

		this.pickerElement.value = this.statusbarService.addEntry(
			{
				name,
				text,
				ariaLabel,
				tooltip: 'Configure Display Language',
				command: ConfigureDisplayLanguageAction.ID
			},
			'status.workbench.locale',
			StatusbarAlignment.RIGHT
		);
	}
}

registerWorkbenchContribution2(LocaleStatusBarContribution.ID, LocaleStatusBarContribution, WorkbenchPhase.BlockRestore);
