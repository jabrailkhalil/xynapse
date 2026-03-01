/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { escape } from '../../../../../base/common/strings.js';
import { localize } from '../../../../../nls.js';
import { ThemeSettingDefaults } from '../../../../services/themes/common/workbenchThemeService.js';

export default () => `
<checklist>
	<div class="theme-picker-row">
		<checkbox when-checked="setTheme:${ThemeSettingDefaults.COLOR_THEME_DARK}" checked-on="config.workbench.colorTheme == '${ThemeSettingDefaults.COLOR_THEME_DARK}'">
			<img width="150" src="./noctisViola.png"/>
			${escape(localize('xynapse', "Xynapse"))}
		</checkbox>
		<checkbox when-checked="setTheme:Grape Twilight" checked-on="config.workbench.colorTheme == 'Grape Twilight'">
			<img width="150" src="./noctisUva.png"/>
			${escape(localize('grapeTwilight', "Grape Twilight"))}
		</checkbox>
		<checkbox when-checked="setTheme:Deep Ocean" checked-on="config.workbench.colorTheme == 'Deep Ocean'">
			<img width="150" src="./noctisAzureus.png"/>
			${escape(localize('deepOcean', "Deep Ocean"))}
		</checkbox>
	</div>
	<div class="theme-picker-row">
		<checkbox when-checked="setTheme:Cherry Blossom" checked-on="config.workbench.colorTheme == 'Cherry Blossom'">
			<img width="150" src="./noctisBordo.png"/>
			${escape(localize('cherryBlossom', "Cherry Blossom"))}
		</checkbox>
		<checkbox when-checked="setTheme:Silent Storm" checked-on="config.workbench.colorTheme == 'Silent Storm'">
			<img width="150" src="./noctisMinimus.png"/>
			${escape(localize('silentStorm', "Silent Storm"))}
		</checkbox>
		<checkbox when-checked="setTheme:Midnight Soul" checked-on="config.workbench.colorTheme == 'Midnight Soul'">
			<img width="150" src="./noctis.png"/>
			${escape(localize('midnightSoul', "Midnight Soul"))}
		</checkbox>
	</div>
	<div class="theme-picker-row">
		<checkbox when-checked="setTheme:Lavender Dream" checked-on="config.workbench.colorTheme == 'Lavender Dream'">
			<img width="150" src="./noctisLilac.png"/>
			${escape(localize('lavenderDream', "Lavender Dream"))}
		</checkbox>
		<checkbox when-checked="setTheme:Sunrise Glow" checked-on="config.workbench.colorTheme == 'Sunrise Glow'">
			<img width="150" src="./noctisLux.png"/>
			${escape(localize('sunriseGlow', "Sunrise Glow"))}
		</checkbox>
		<checkbox when-checked="setTheme:Winter Frost" checked-on="config.workbench.colorTheme == 'Winter Frost'">
			<img width="150" src="./noctisHibernus.png"/>
			${escape(localize('winterFrost', "Winter Frost"))}
		</checkbox>
	</div>
</checklist>
`;
