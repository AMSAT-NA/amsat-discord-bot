import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Collection,
  SlashCommandBuilder,
} from 'discord.js';
import * as verify     from './verify';
import * as membership from './membership';
import * as admin      from './admin';
import * as tle        from './tle';

export interface Command {
  data: SlashCommandBuilder | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

export const commands = new Collection<string, Command>();

for (const cmd of [verify, membership, admin, tle]) {
  commands.set(cmd.data.name, cmd as Command);
}
