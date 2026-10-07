#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import {
  DEFAULT_LOCAL_CONFIG,
  DEFAULT_OAUTH_TOKEN,
  DEFAULT_SERVICE_ACCOUNT,
  discoverCalendarPackageFile,
  loadCalendarDefinition,
  loadCalendarRequiredEnvironment
} from "./config.js";
import {
  authLogin,
  authLogout,
  authStatus,
  calendarDoctor,
  listCalendars,
  resolveLaunchdLabel,
  setCalendarId,
  showSyncedEvents,
  syncCalendar
} from "./google.js";
import { installLaunchdSync, statusLaunchdSync, uninstallLaunchdSync } from "./launchd.js";
import type { AuthMode, SyncOptions } from "./types.js";
import {
  CliError,
  discoverProjectRoot,
  formatEnvironmentRequirementStatus,
  inspectEnvironmentRequirement
} from "./utils.js";
import { formatVersionInfo, getVersionInfo } from "./version.js";

const scriptFile = fileURLToPath(import.meta.url);
const projectRoot = discoverProjectRoot(scriptFile);

function usage() {
  console.log(`Usage:
  linear-gsuite version
  linear-gsuite --version
  linear-gsuite doctor [--config FILE] [--local-config-file FILE]
  linear-gsuite auth <login|status|logout> [--client-secrets-file FILE] [--token-file FILE] [--local-config-file FILE] [--no-open]
  linear-gsuite calendar sync [--config FILE] [--dry-run] [--auth-mode auto|user|service-account] [--calendar-id ID]
  linear-gsuite calendar <doctor|list-calendars|set-calendar|show-events> [--config FILE] [--local-config-file FILE]
  linear-gsuite launchd <install|uninstall|status> sync [--config FILE] [--local-config-file FILE]

Flags:
  --config FILE              Calendar package manifest (auto-discovered if omitted)
  --local-config-file FILE   Local config (default: ~/.config/linear-gsuite/config.json)
  --dry-run                  Log what would change without writing to Google Calendar
  --auth-mode MODE           Force auth mode: auto, user, or service-account
  --calendar-id ID           Override target calendar (default: from config or "primary")
`);
}

function valueFlag(args: string[], name: string, fallback = "") {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] || fallback;
}

function booleanFlag(args: string[], name: string) {
  return args.includes(name);
}

function syncOptionsFromArgs(args: string[], configRequired: boolean): Effect.Effect<SyncOptions, CliError> {
  return Effect.gen(function* () {
    const discovered = configRequired
      ? (yield* discoverCalendarPackageFile(process.cwd(), projectRoot))
      : "";
    return {
      configFile: valueFlag(args, "--config", discovered),
      localConfigFile: valueFlag(args, "--local-config-file", DEFAULT_LOCAL_CONFIG),
      authMode: (valueFlag(args, "--auth-mode", "auto") as AuthMode) || "auto",
      oauthClientSecretsFile: valueFlag(args, "--oauth-client-secrets-file", ""),
      oauthTokenFile: valueFlag(args, "--oauth-token-file", DEFAULT_OAUTH_TOKEN),
      serviceAccountFile: valueFlag(args, "--service-account-file", DEFAULT_SERVICE_ACCOUNT),
      impersonate: valueFlag(args, "--impersonate", ""),
      calendarId: valueFlag(args, "--calendar-id", ""),
      dryRun: booleanFlag(args, "--dry-run")
    };
  });
}

function run(effect: Effect.Effect<void, CliError>) {
  return Effect.runPromise(
    Effect.catch(effect, (error) =>
      Effect.sync(() => {
        console.error(error.message);
        process.exitCode = 1;
      })
    )
  );
}

function printEnvironmentRequirements(configFile: string) {
  return Effect.gen(function* () {
    const env = yield* loadCalendarRequiredEnvironment(configFile, process.cwd());
    if (env.requiredEnvironment.length === 0) return;

    console.log("[environment]");
    for (const name of env.requiredEnvironment) {
      console.log(`- ${formatEnvironmentRequirementStatus(inspectEnvironmentRequirement(name))}`);
    }
    console.log("");
  });
}

function doctorCommand(args: string[]) {
  return Effect.gen(function* () {
    const options = yield* syncOptionsFromArgs(args, true);
    yield* printEnvironmentRequirements(options.configFile);
    const definition = yield* loadCalendarDefinition(options.configFile, process.cwd());
    console.log(`package: ${path.basename(definition.configFile)}`);
    console.log(`package config: ${definition.configFile}`);
    console.log(`calendar sources: ${definition.sources.length}`);
    for (const source of definition.sources) {
      console.log(`- ${source.id} | ${source.type} | events=${source.eventCount} | ${source.path ?? "(virtual)"}`);
    }
    console.log(`merged event count: ${definition.events.length}`);
    console.log(`local config: ${options.localConfigFile}`);
    console.log("");
    console.log("[auth]");
    yield* authStatus({
      clientSecretsFile: options.oauthClientSecretsFile,
      tokenFile: options.oauthTokenFile,
      localConfigFile: options.localConfigFile
    });
    console.log("");
    console.log("[calendar]");
    yield* calendarDoctor(options);
    console.log("");
    console.log("[synced events]");
    yield* showSyncedEvents(options.localConfigFile);
    console.log("");
    console.log("[launchd]");
    const label = yield* resolveLaunchdLabel(options.configFile, process.cwd());
    yield* statusLaunchdSync(label);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    usage();
    process.exit(1);
    return;
  }

  if (args[0] === "version" || args[0] === "--version" || args[0] === "-v") {
    console.log(formatVersionInfo(getVersionInfo(projectRoot)));
    return;
  }

  if (args[0] === "doctor") {
    await run(doctorCommand(args.slice(1)));
    return;
  }

  if (args[0] === "auth") {
    const command = args[1];
    if (!command || !["login", "status", "logout"].includes(command)) {
      usage();
      process.exit(1);
      return;
    }
    const localConfigFile = valueFlag(args, "--local-config-file", DEFAULT_LOCAL_CONFIG);
    const tokenFile = valueFlag(args, "--token-file", DEFAULT_OAUTH_TOKEN);
    const clientSecretsFile = valueFlag(args, "--client-secrets-file", "");
    if (command === "login") {
      await run(
        authLogin({
          clientSecretsFile,
          tokenFile,
          localConfigFile,
          openBrowser: !booleanFlag(args, "--no-open")
        })
      );
      return;
    }
    if (command === "status") {
      await run(
        authStatus({
          clientSecretsFile,
          tokenFile,
          localConfigFile
        })
      );
      return;
    }
    await run(authLogout({ tokenFile, localConfigFile }));
    return;
  }

  if (args[0] === "calendar") {
    const command = args[1];
    if (!command || !["doctor", "list-calendars", "set-calendar", "sync", "show-events"].includes(command)) {
      usage();
      process.exit(1);
      return;
    }

    if (command === "show-events") {
      await run(showSyncedEvents(valueFlag(args, "--local-config-file", DEFAULT_LOCAL_CONFIG)));
      return;
    }

    if (command === "set-calendar") {
      const calendarId = valueFlag(args, "--calendar-id", "");
      if (!calendarId) {
        console.error("set-calendar requires --calendar-id");
        process.exit(1);
        return;
      }
      await run(setCalendarId(calendarId, valueFlag(args, "--local-config-file", DEFAULT_LOCAL_CONFIG)));
      return;
    }

    const options = await Effect.runPromise(syncOptionsFromArgs(args.slice(2), command === "doctor" || command === "sync"));
    if (command === "doctor") {
      await run(
        Effect.gen(function* () {
          yield* printEnvironmentRequirements(options.configFile);
          yield* calendarDoctor(options);
        })
      );
      return;
    }
    if (command === "list-calendars") {
      await run(listCalendars(options));
      return;
    }
    await run(syncCalendar(options));
    return;
  }

  if (args[0] === "launchd") {
    const action = args[1];
    const target = args[2];
    if (!action || !["install", "uninstall", "status"].includes(action) || target !== "sync") {
      usage();
      process.exit(1);
      return;
    }

    const options = await Effect.runPromise(syncOptionsFromArgs(args.slice(3), action === "install" || action === "status"));
    const label = options.configFile
      ? await Effect.runPromise(resolveLaunchdLabel(options.configFile, process.cwd()))
      : undefined;

    if (action === "status") {
      await run(statusLaunchdSync(label));
      return;
    }
    if (action === "uninstall") {
      await run(uninstallLaunchdSync(label));
      return;
    }

    await run(
      Effect.gen(function* () {
        const definition = yield* loadCalendarDefinition(options.configFile, process.cwd());
        const environment: Record<string, string> = {};
        const environmentFiles: Record<string, string> = {};
        for (const name of definition.requiredEnvironment) {
          const value = process.env[name];
          const file = process.env[`${name}_FILE`];
          if (file) {
            const status = inspectEnvironmentRequirement(name);
            if (!status.fileReadable) {
              return yield* Effect.fail(
                new CliError(`launchd install requires readable ${status.fileVariable}. ${formatEnvironmentRequirementStatus(status)}.`)
              );
            }
            environmentFiles[name] = file;
            continue;
          }
          if (!value) {
            return yield* Effect.fail(
              new CliError(
                `launchd install requires ${name} or ${name}_FILE so the background sync can use enabled source adapters.`
              )
            );
          }
          environment[name] = value;
        }
        yield* installLaunchdSync({
          label,
          definition,
          configFile: definition.configFile,
          localConfigFile: options.localConfigFile,
          scriptFile,
          projectRoot,
          syncIntervalSeconds: definition.agents?.["calendar-sync"]?.startIntervalSeconds,
          environment,
          environmentFiles
        });
      })
    );
    return;
  }

  usage();
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
