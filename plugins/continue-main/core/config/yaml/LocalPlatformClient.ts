import {
  FQSN,
  PlatformClient,
  SecretResult,
  SecretType,
} from "@xynapse/config-yaml";
import * as dotenv from "dotenv";
import { IDE } from "../..";
import { ControlPlaneClient } from "../../control-plane/client";
import { getXynapseDotEnv } from "../../util/paths";
import { joinPathsToUri } from "../../util/uri";

export class LocalPlatformClient implements PlatformClient {
  constructor(
    private orgScopeId: string | null,
    private readonly client: ControlPlaneClient,
    private readonly ide: IDE,
  ) {}

  /**
   * searches for the first valid secret file in order of ~/.xynapse/.env, <workspace>/.xynapse/.env, <workspace>/.env
   */
  private async findSecretInEnvFiles(
    fqsn: FQSN,
  ): Promise<SecretResult | undefined> {
    const secretValue =
      this.findSecretInLocalEnvFile(fqsn) ??
      (await this.findSecretInWorkspaceEnvFiles(fqsn, true)) ??
      (await this.findSecretInWorkspaceEnvFiles(fqsn, false));

    if (secretValue) {
      return {
        found: true,
        fqsn,
        value: secretValue,
        secretLocation: {
          secretName: fqsn.secretName,
          secretType: SecretType.LocalEnv,
        },
      };
    }
    return undefined;
  }

  private findSecretInLocalEnvFile(fqsn: FQSN): string | undefined {
    try {
      const dotEnv = getXynapseDotEnv();
      return dotEnv[fqsn.secretName];
    } catch (error) {
      console.warn("Could not read the local secrets file.");
      return undefined;
    }
  }

  private async findSecretInWorkspaceEnvFiles(
    fqsn: FQSN,
    insideXynapse: boolean,
  ): Promise<string | undefined> {
    try {
      const workspaceDirs = await this.ide.getWorkspaceDirs();
      for (const folder of workspaceDirs) {
        const envFilePath = joinPathsToUri(
          folder,
          insideXynapse ? ".xynapse" : "",
          ".env",
        );
        try {
          const fileExists = await this.ide.fileExists(envFilePath);
          if (fileExists) {
            const envContent = await this.ide.readFile(envFilePath);
            const env = dotenv.parse(envContent);
            if (fqsn.secretName in env) {
              return env[fqsn.secretName];
            }
          }
        } catch (error) {
          console.warn("Could not read a workspace secrets file.");
          // Xynapse to next workspace folder
        }
      }

      return undefined;
    } catch (error) {
      console.warn("Could not search workspace secrets files.");
      return undefined;
    }
  }

  async resolveFQSNs(fqsns: FQSN[]): Promise<(SecretResult | undefined)[]> {
    if (fqsns.length === 0) {
      return [];
    }

    let results: (SecretResult | undefined)[] = [];
    try {
      results = await this.client.resolveFQSNs(fqsns, this.orgScopeId);
    } catch (e) {
      console.error(
        "Could not resolve secrets through the control plane; checking local configuration.",
      );
    }

    // For any secret that isn't found, look in .env files, then process.env
    results = fqsns.map((_, index) => results[index]);
    for (let i = 0; i < fqsns.length; i++) {
      if (!results[i]?.found) {
        let secretResult = await this.findSecretInEnvFiles(fqsns[i]);

        // If not found in .env files, try process.env
        if (!secretResult?.found) {
          const secretValueFromProcessEnv = process.env[fqsns[i].secretName];
          if (secretValueFromProcessEnv !== undefined) {
            secretResult = {
              found: true,
              fqsn: fqsns[i],
              value: secretValueFromProcessEnv,
              secretLocation: {
                secretName: fqsns[i].secretName,
                // Cast to SecretType.ProcessEnv is necessary because the specific type
                // ProcessEnvSecretLocation expects secretType to be exactly SecretType.ProcessEnv,
                // not the general enum SecretType.
                secretType: SecretType.ProcessEnv as SecretType.ProcessEnv,
              },
            };
          }
        }

        if (secretResult?.found) {
          results[i] = secretResult;
        }
      }
    }

    return results;
  }
}
