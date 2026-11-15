import { buildCommandRegistry } from '../commands';
import { synchronizeDiscordSlashCommands } from '../index';
import { createModuleLogger } from '../../../../packages/shared/src';

const log = createModuleLogger('DeployCommands');

export async function runCommandDeployment() {
  const registry = buildCommandRegistry();
  const payload = Array.from(registry.values()).map((c) => c.data.toJSON());

  const animeCmd = payload.find((c) => c.name === 'anime');
  if (!animeCmd) {
    throw new Error('Missing /anime command in registry.');
  }

  const subcommands = (animeCmd.options || []).map((o: any) => o.name);
  if (!subcommands.includes('recommendation')) {
    throw new Error('Missing /anime recommendation subcommand in registry.');
  }
  if (subcommands.includes('recommendations')) {
    throw new Error('Obsolete /anime recommendations subcommand is still present in registry.');
  }
  if (payload.some((c) => c.name === 'recommendations')) {
    throw new Error('Obsolete top-level /recommendations command is still present in registry.');
  }
  if (!payload.some((c) => c.name === 'aniguess')) {
    throw new Error('Missing /aniguess command in registry.');
  }
  if (payload.some((c) => c.name === 'aniquiz')) {
    throw new Error('Obsolete /aniquiz command is still present in registry.');
  }

  const recSub = (animeCmd.options || []).find((o: any) => o.name === 'recommendation') as any;
  log.info(
    {
      totalCommands: payload.length,
      animeSubcommands: subcommands,
      recommendationSubcommand: {
        name: recSub?.name,
        description: recSub?.description,
        options: (recSub?.options || []).map((o: any) => ({ name: o.name, required: o.required })),
      },
    },
    'Verified slash command registry payload'
  );

  const syncResult = await synchronizeDiscordSlashCommands();
  if (syncResult.synced) {
    log.info(syncResult, 'Successfully synchronized slash commands with Discord REST API');
  } else {
    log.info(syncResult, 'Validated local slash command definitions (Discord REST skipped)');
  }

  return {
    totalCommands: payload.length,
    animeSubcommands: subcommands,
    recommendationSubcommand: recSub,
    syncResult,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCommandDeployment()
    .then((res) => {
      console.log(
        JSON.stringify(
          {
            ok: true,
            totalCommands: res.totalCommands,
            animeSubcommands: res.animeSubcommands,
            recommendationDescription: res.recommendationSubcommand?.description,
            discordSync: res.syncResult,
          },
          null,
          2
        )
      );
    })
    .catch((err) => {
      console.error('Failed to deploy commands:', err);
      process.exit(1);
    });
}
