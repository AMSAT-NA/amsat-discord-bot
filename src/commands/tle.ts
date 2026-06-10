import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Colors,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config';

// AMSAT "NASA bare" TLE feed — 3-line format: name / line1 / line2
const TLE_URL = 'https://www.amsat.org/tle/current/nasabare.txt';
const MAX_AUTOCOMPLETE_CHOICES = 25; // hard Discord API limit
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let catalogNamesCache: string[] = [];
let catalogLastFetchedAt = 0;
let catalogFetchPromise: Promise<string[]> | null = null;

let tleEntriesCache: TleEntry[] = [];
let tleLastFetchedAt = 0;
let tleFetchPromise: Promise<TleEntry[]> | null = null;

interface TleEntry {
  name: string;
  line1: string;
  line2: string;
}

// ─── Command definition ────────────────────────────────────────────────────────

export const data = new SlashCommandBuilder()
  .setName('tle')
  .setDescription('Look up AMSAT TLE data.')
  .addSubcommand(sub =>
    sub
      .setName('get')
      .setDescription('Get TLE data for a satellite')
      .addStringOption(opt =>
        opt
          .setName('name')
          .setDescription('Satellite name, e.g. AO-91, RS-44, ARISS')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('list')
      .setDescription('Browse available satellites from AMSAT status catalog')
      .addStringOption(opt =>
        opt
          .setName('filter')
          .setDescription('Optional filter, e.g. AO or FOX')
          .setRequired(false),
      ),
  );

// ─── Handler ───────────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'list') {
    await handleList(interaction);
    return;
  }

  await handleLookup(interaction);
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'name') {
    await interaction.respond([]);
    return;
  }

  try {
    const query = String(focused.value ?? '').trim();
    const names = await getCatalogNames();
    const suggestedNames = rankNames(names, query, MAX_AUTOCOMPLETE_CHOICES);

    await interaction.respond(
      suggestedNames.map(name => ({
        name: name.slice(0, 100),
        value: name,
      })),
    );
  } catch (err) {
    logger.warn('TLE autocomplete failed', { err, user: interaction.user.tag });
    await interaction.respond([]);
  }
}

export async function prefetchTleCatalog(): Promise<void> {
  try {
    const [names] = await Promise.all([getCatalogNames(true), getTleEntries(true)]);
    logger.info('TLE catalog warmed', { count: names.length });
  } catch (err) {
    logger.warn('Failed to prefetch TLE catalog', { err });
  }
}

async function handleLookup(interaction: ChatInputCommandInteraction): Promise<void> {
  // TLE data is public — not ephemeral so the channel benefits from the shared lookup.
  await interaction.deferReply();
  const rawQuery = interaction.options.getString('name', true).trim();

  try {
    const entries = await getTleEntries();
    const catalogNames = await getCatalogNames().catch(() => entries.map(entry => entry.name));
    const matches = findMatches(entries, rawQuery);
    const queryUpper = rawQuery.toUpperCase();

    if (matches.length === 0) {
      const suggestions = rankNames(catalogNames, rawQuery, 5);
      logger.info('TLE not found', { query: queryUpper, user: interaction.user.tag });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle('🛰️  Satellite Not Found')
            .setDescription(
              `No TLE data found for **${queryUpper}**.\n\n` +
              (suggestions.length > 0
                ? `Did you mean: ${suggestions.map(name => `\`${name}\``).join(', ')}?\n\n`
                : '') +
              'Use `/tle list` to browse available satellites.',
            )
            .setFooter({ text: 'Source: AMSAT status API catalog + AMSAT TLE feed' }),
        ],
      });
      return;
    }

    if (matches.length > 1) {
      const options = matches.slice(0, 5).map(entry => `\`${entry.name}\``).join(', ');
      logger.info('TLE lookup ambiguous', { query: queryUpper, matches: matches.length, user: interaction.user.tag });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle('🛰️  Multiple Matches Found')
            .setDescription(
              `Your input **${queryUpper}** matches multiple satellites.\n\n` +
              `Try one of: ${options}\n\n` +
              'Use autocomplete or `/tle list` to pick an exact name.',
            )
            .setFooter({ text: 'Source: AMSAT status API catalog + AMSAT TLE feed' }),
        ],
      });
      return;
    }

    const entry = matches[0]!;
    logger.info('TLE lookup successful', { query: queryUpper, matched: entry.name, user: interaction.user.tag });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Blue)
          .setTitle(`🛰️  ${entry.name}`)
          .setDescription(`\`\`\`\n${entry.name}\n${entry.line1}\n${entry.line2}\n\`\`\``)
          .setFooter({ text: 'Source: AMSAT TLE feed · nasabare.txt' })
          .setTimestamp(),
      ],
    });
  } catch (err) {
    logger.error('Error in /tle get', { err, query: rawQuery.toUpperCase() });
    await interaction.editReply(
      'There was an error contacting the AMSAT data sources. Please try again later.',
    );
  }
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const filter = interaction.options.getString('filter', false)?.trim() ?? '';

  try {
    const names = await getCatalogNames();
    const filteredNames = rankNames(names, filter, names.length);

    if (filteredNames.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle('🛰️  No Satellites Matched')
            .setDescription(
              filter.length > 0
                ? `No satellites matched **${filter.toUpperCase()}**.\nTry a shorter filter or use \`/tle get\` with autocomplete.`
                : 'No satellites are currently available in the AMSAT catalog.',
            )
            .setFooter({ text: 'Source: AMSAT status API catalog' }),
        ],
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.Blue)
          .setTitle('🛰️  Available Satellites')
          .setDescription(formatAsColumns(filteredNames, 2))
          .addFields({
            name: 'Results',
            value: filter.length > 0
              ? `${filteredNames.length} of ${names.length} satellites match \`${filter.toUpperCase()}\`.`
              : `${filteredNames.length} satellites in the AMSAT catalog.`,
          })
          .setFooter({ text: 'Source: AMSAT status API catalog' })
          .setTimestamp(),
      ],
    });
  } catch (err) {
    logger.error('Error in /tle list', { err, filter: filter.toUpperCase() || null });
    await interaction.editReply(
      'There was an error contacting the AMSAT status catalog. Please try again later.',
    );
  }
}

async function getCatalogNames(forceRefresh = false): Promise<string[]> {
  const now = Date.now();
  if (!forceRefresh && catalogNamesCache.length > 0 && now - catalogLastFetchedAt < CACHE_TTL_MS) {
    return catalogNamesCache;
  }

  if (catalogFetchPromise) return catalogFetchPromise;

  catalogFetchPromise = Promise.all([fetchCatalogNames(), getTleEntries(forceRefresh)])
    .then(([rawNames, tleEntries]) => {
      // Only keep catalog names that resolve to an actual TLE entry. This prevents
      // list/autocomplete from showing satellites with no current TLE data, which
      // would always produce a "not found" error when selected.
      const validNames = rawNames.filter(name => findMatches(tleEntries, name).length > 0);
      catalogNamesCache = validNames;
      catalogLastFetchedAt = Date.now();
      return validNames;
    })
    .finally(() => {
      catalogFetchPromise = null;
    });

  return catalogFetchPromise;
}

async function getTleEntries(forceRefresh = false): Promise<TleEntry[]> {
  const now = Date.now();
  if (!forceRefresh && tleEntriesCache.length > 0 && now - tleLastFetchedAt < CACHE_TTL_MS) {
    return tleEntriesCache;
  }

  if (tleFetchPromise) return tleFetchPromise;

  tleFetchPromise = fetchTleEntries()
    .then(entries => {
      tleEntriesCache = entries;
      tleLastFetchedAt = Date.now();
      return entries;
    })
    .finally(() => {
      tleFetchPromise = null;
    });

  return tleFetchPromise;
}

async function fetchCatalogNames(): Promise<string[]> {
  const { data, status } = await axios.get<unknown>(config.SATELLITE_STATUS_API_CATALOG_ENDPOINT, {
    timeout: 15000,
  });

  if (status !== 200) {
    throw new Error(`Catalog endpoint returned status ${status}`);
  }

  const names = parseCatalogNames(data);
  if (names.length === 0) {
    throw new Error('Catalog endpoint returned no satellite names');
  }

  return names;
}

function parseCatalogNames(payload: unknown): string[] {
  const names = new Set<string>();

  const visit = (node: unknown): void => {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }

    if (typeof node === 'object') {
      const record = node as Record<string, unknown>;
      const directName = readNameFromRecord(record);
      if (directName) {
        names.add(directName);
      }

      for (const value of Object.values(record)) {
        if (Array.isArray(value) || typeof value === 'object') {
          visit(value);
        }
      }
      return;
    }

    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (isLikelySatelliteName(trimmed)) {
        names.add(trimmed);
      }
    }
  };

  visit(payload);

  // Strip operating-mode suffixes like "[FM]" or "[Mode B]" and trailing
  // underscores so catalog names match the TLE feed bare names. Dedup after.
  const cleanNames = new Set<string>();
  for (const raw of names) {
    const clean = raw.replace(/\s*\[.*?\]\s*$/, '').replace(/_+$/, '').trim();
    if (isLikelySatelliteName(clean)) cleanNames.add(clean);
  }
  return [...cleanNames].sort((a, b) => a.localeCompare(b));
}

function readNameFromRecord(record: Record<string, unknown>): string | null {
  const keys = [
    'name',
    'satellite',
    'sat_name',
    'satname',
    'display_name',
    'catalog_name',
    'tle0',
  ];

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (isLikelySatelliteName(trimmed)) {
        return trimmed;
      }
    }
  }

  return null;
}

function isLikelySatelliteName(value: string): boolean {
  if (value.length < 2 || value.length > 64) return false;
  if (!/[A-Z]/i.test(value)) return false;
  if (value.includes('http://') || value.includes('https://')) return false;
  return true;
}

async function fetchTleEntries(): Promise<TleEntry[]> {
  const { data: rawTle, status } = await axios.get<string>(TLE_URL, {
    responseType: 'text',
    timeout: 15000,
  });

  if (status !== 200) {
    throw new Error(`TLE endpoint returned status ${status}`);
  }

  const lines = rawTle
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const entries: TleEntry[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i]!;
    const line1 = lines[i + 1]!;
    const line2 = lines[i + 2]!;

    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
      logger.warn('Skipping malformed TLE entry', { name, line1, line2 });
      continue;
    }

    entries.push({ name, line1, line2 });
  }

  if (entries.length === 0) {
    throw new Error('TLE feed contained no valid entries');
  }

  return entries;
}

function findMatches(entries: TleEntry[], query: string): TleEntry[] {
  const queryUpper = query.toUpperCase();
  const normalizedQuery = normalizeName(query);

  const exact = entries.find(entry => entry.name.toUpperCase() === queryUpper);
  if (exact) return [exact];

  const normalizedExact = entries.find(entry => normalizeName(entry.name) === normalizedQuery);
  if (normalizedExact) return [normalizedExact];

  if (normalizedQuery.length === 0) return [];

  const startsWithMatches = entries.filter(entry =>
    normalizeName(entry.name).startsWith(normalizedQuery),
  );
  if (startsWithMatches.length > 0) return startsWithMatches;

  return entries.filter(entry => normalizeName(entry.name).includes(normalizedQuery));
}

function rankNames(names: string[], query: string, limit: number): string[] {
  const normalizedQuery = normalizeName(query);

  if (normalizedQuery.length === 0) {
    return [...names].sort((a, b) => a.localeCompare(b)).slice(0, limit);
  }

  return [...names]
    .map(name => ({
      name,
      score: scoreName(name, normalizedQuery),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(item => item.name);
}

function scoreName(name: string, normalizedQuery: string): number {
  const normalizedName = normalizeName(name);
  if (normalizedName === normalizedQuery) return 1000;
  if (normalizedName.startsWith(normalizedQuery)) return 800 - (normalizedName.length - normalizedQuery.length);

  const includeIndex = normalizedName.indexOf(normalizedQuery);
  if (includeIndex >= 0) return 600 - includeIndex;

  const distance = levenshteinDistance(normalizedName, normalizedQuery);
  if (distance <= 2) return 400 - distance * 100;

  return 0;
}

function normalizeName(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatAsColumns(names: string[], cols: number): string {
  const colWidth = Math.max(...names.map(n => n.length)) + 3;
  const lines: string[] = [];
  for (let i = 0; i < names.length; i += cols) {
    const row = names.slice(i, i + cols);
    const line = row.map((name, j) => j < row.length - 1 ? name.padEnd(colWidth) : name).join('');
    lines.push(line);
  }
  return '```\n' + lines.join('\n') + '\n```';
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => []);
  for (let i = 0; i <= a.length; i += 1) matrix[i]![0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0]![j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + substitutionCost,
      );
    }
  }

  return matrix[a.length]![b.length]!;
}
