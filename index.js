const fs = require("fs");
const path = require("path");
const emojiData = require("emoji-datasource");

const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) throw new Error("Missing DISCORD_TOKEN environment variable.");

const DATA_DIR = fs.existsSync("/data") ? "/data" : __dirname;
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

const MAX_TARGET_USERS = 100;
const MAX_SELECTED_EMOJIS = 80;
const MAX_SAVED_EMOJIS = 200;
const MAX_RESPONSES = 200;
const MAX_RESPONSES_PER_PHRASE = 20;
const MAX_REACT_COUNT = 20;

const REACTION_MODES = [
  "all-selected",
  "all-saved",
  "random-selected",
  "random-saved",
  "random-standard",
  "random-server",
  "random-any",
];

const MANUAL_REACT_SOURCES = [
  "typed",
  "all-selected",
  "all-saved",
  "random-selected",
  "random-saved",
  "random-standard",
  "random-server",
  "random-any",
];

function unique(array) {
  return [...new Set(array.filter(Boolean))];
}

function randItem(array) {
  if (!array || array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

function codepointsToEmoji(unified) {
  try {
    return unified
      .split("-")
      .map((part) => String.fromCodePoint(parseInt(part, 16)))
      .join("");
  } catch {
    return null;
  }
}

const STANDARD_EMOJIS = unique(
  emojiData
    .map((entry) => codepointsToEmoji(entry.unified))
    .filter(Boolean)
);

function ensureGuildSettings(settings, guildId) {
  if (!settings[guildId]) settings[guildId] = {};
  const g = settings[guildId];

  // Migrate older settings from v1-v5 shapes where possible.
  if (g.userId && !g.userIds) g.userIds = [g.userId];
  if (g.emoji && !g.selectedEmojis) g.selectedEmojis = [g.emoji];
  if (g.emojis && !g.selectedEmojis) g.selectedEmojis = g.emojis;

  if (!Array.isArray(g.userIds)) g.userIds = [];
  if (!Array.isArray(g.selectedEmojis)) g.selectedEmojis = [];
  if (!Array.isArray(g.savedEmojis)) g.savedEmojis = [];
  if (!Array.isArray(g.whitelist)) g.whitelist = [];
  if (!Array.isArray(g.autoResponses)) g.autoResponses = [];

  if (!REACTION_MODES.includes(g.mode)) {
    if (g.mode === "all-configured") g.mode = "all-selected";
    else if (g.mode === "random-configured") g.mode = "random-selected";
    else g.mode = "all-selected";
  }

  if (typeof g.enabled !== "boolean") g.enabled = true;
  if (typeof g.autoResponsesEnabled !== "boolean") g.autoResponsesEnabled = true;

  g.userIds = unique(g.userIds.map(String)).slice(0, MAX_TARGET_USERS);
  g.selectedEmojis = unique(g.selectedEmojis.map(String)).slice(0, MAX_SELECTED_EMOJIS);
  g.savedEmojis = unique(g.savedEmojis.map(String)).slice(0, MAX_SAVED_EMOJIS);
  g.whitelist = unique(g.whitelist.map(String));

  // Normalize response records.
  g.autoResponses = g.autoResponses
    .filter((item) => item && typeof item.phrase === "string")
    .map((item) => ({
      id: item.id || makeId(),
      phrase: item.phrase,
      responses: unique(Array.isArray(item.responses) ? item.responses.map(String) : [String(item.response || "")]).filter(Boolean).slice(0, MAX_RESPONSES_PER_PHRASE),
      match: ["contains", "word", "exact"].includes(item.match) ? item.match : "contains",
      caseSensitive: Boolean(item.caseSensitive),
      enabled: item.enabled !== false,
      updatedAt: item.updatedAt || new Date().toISOString(),
    }))
    .filter((item) => item.responses.length > 0)
    .slice(0, MAX_RESPONSES);

  return g;
}

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    for (const guildId of Object.keys(data)) ensureGuildSettings(data, guildId);
    return data;
  } catch (err) {
    console.error("Failed to load settings.json:", err);
    return {};
  }
}

function saveSettings() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

let settings = loadSettings();

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function parseUserIds(input) {
  if (!input) return [];
  const ids = [];
  const re = /<@!?(\d{17,20})>|\b(\d{17,20})\b/g;
  let match;
  while ((match = re.exec(input)) !== null) ids.push(match[1] || match[2]);
  return unique(ids);
}

async function ensureGuildEmojiCache(guild) {
  try {
    await guild.emojis.fetch();
  } catch (err) {
    console.warn(`Could not fetch emojis for guild ${guild.id}:`, err.message);
  }
}

function serverEmojiToReactionString(emoji) {
  return emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;
}

function parseEmojiInput(input, guild) {
  if (!input) return [];

  const tokens = input
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const result = [];

  for (const token of tokens) {
    const custom = token.match(/^<(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>$/);
    if (custom) {
      result.push(`<${custom[1] ? "a" : ""}:${custom[2]}:${custom[3]}>`);
      continue;
    }

    const named = token.match(/^:([A-Za-z0-9_]{2,32}):$/);
    if (named && guild) {
      const found = guild.emojis.cache.find((e) => e.name === named[1]);
      if (found) {
        result.push(serverEmojiToReactionString(found));
        continue;
      }
    }

    result.push(token);
  }

  return unique(result);
}

function removeValues(existing, valuesToRemove) {
  const removeSet = new Set(valuesToRemove);
  return existing.filter((value) => !removeSet.has(value));
}

function canManageBot(interaction) {
  if (!interaction.guild || !interaction.member) return false;
  const guildSettings = ensureGuildSettings(settings, interaction.guild.id);
  if (interaction.user.id === interaction.guild.ownerId) return true;
  if (interaction.member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return guildSettings.whitelist.includes(interaction.user.id);
}

function canManageWhitelist(interaction) {
  if (!interaction.guild || !interaction.member) return false;
  if (interaction.user.id === interaction.guild.ownerId) return true;
  return interaction.member.permissions?.has(PermissionFlagsBits.Administrator);
}

async function requireManageBot(interaction) {
  if (canManageBot(interaction)) return true;
  await interaction.reply({
    content: "You need to be the server owner, an Administrator, or whitelisted to use this command.",
    ephemeral: true,
  });
  return false;
}

async function requireManageWhitelist(interaction) {
  if (canManageWhitelist(interaction)) return true;
  await interaction.reply({
    content: "Only the server owner or members with Administrator can manage the whitelist.",
    ephemeral: true,
  });
  return false;
}

function buildCommands() {
  const autoreact = new SlashCommandBuilder()
    .setName("autoreact")
    .setDescription("Configure automatic reactions.")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Add target users, selected emojis, or change reaction mode. Additive by default.")
        .addStringOption((opt) =>
          opt.setName("users").setDescription("Mentions or IDs, separated by spaces or commas.").setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName("emojis").setDescription("Selected emojis for selected-emoji modes.").setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName("mode")
            .setDescription("How to react to target users.")
            .setRequired(false)
            .addChoices(...REACTION_MODES.map((m) => ({ name: m, value: m })))
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("save")
        .setDescription("Save emoji for saved-emoji modes. This only needs emoji.")
        .addStringOption((opt) => opt.setName("emoji").setDescription("Emoji to save, separated by spaces or commas.").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("unsave")
        .setDescription("Remove emoji from saved-emoji modes. This only needs emoji.")
        .addStringOption((opt) => opt.setName("emoji").setDescription("Emoji to unsave, separated by spaces or commas.").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove target users or selected emojis without changing other settings.")
        .addStringOption((opt) => opt.setName("users").setDescription("Mentions or IDs to remove.").setRequired(false))
        .addStringOption((opt) => opt.setName("selected_emojis").setDescription("Selected emojis to remove.").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Clear one part of the reaction configuration.")
        .addStringOption((opt) =>
          opt
            .setName("target")
            .setDescription("What to clear.")
            .setRequired(true)
            .addChoices(
              { name: "target-users", value: "target-users" },
              { name: "selected-emojis", value: "selected-emojis" },
              { name: "saved-emojis", value: "saved-emojis" },
              { name: "all-reaction-settings", value: "all-reaction-settings" }
            )
        )
    )
    .addSubcommand((sub) => sub.setName("off").setDescription("Disable automatic reactions, keeping saved settings."))
    .addSubcommand((sub) => sub.setName("on").setDescription("Enable automatic reactions."))
    .addSubcommand((sub) => sub.setName("status").setDescription("Show reaction settings."))
    .addSubcommand((sub) =>
      sub
        .setName("react")
        .setDescription("Add reactions to a specific existing message.")
        .addStringOption((opt) => opt.setName("message").setDescription("Message ID or Discord message link.").setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName("source")
            .setDescription("Where the reaction emojis should come from.")
            .setRequired(true)
            .addChoices(...MANUAL_REACT_SOURCES.map((s) => ({ name: s, value: s })))
        )
        .addStringOption((opt) => opt.setName("emoji").setDescription("Required only when source is typed.").setRequired(false))
        .addIntegerOption((opt) => opt.setName("count").setDescription("For random sources only. 1-20.").setRequired(false).setMinValue(1).setMaxValue(MAX_REACT_COUNT))
    )
    .addSubcommand((sub) =>
      sub
        .setName("whitelist-add")
        .setDescription("Allow users to configure the bot.")
        .addStringOption((opt) => opt.setName("users").setDescription("Mentions or IDs to whitelist.").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("whitelist-remove")
        .setDescription("Remove users from the bot command whitelist.")
        .addStringOption((opt) => opt.setName("users").setDescription("Mentions or IDs to remove.").setRequired(true))
    )
    .addSubcommand((sub) => sub.setName("whitelist-status").setDescription("Show whitelisted users."))
    .addSubcommand((sub) => sub.setName("whitelist-clear").setDescription("Clear the whitelist."));

  const autoresponse = new SlashCommandBuilder()
    .setName("autoresponse")
    .setDescription("Configure phrase-based bot messages.")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a phrase trigger and response. Reusing a phrase adds another random response.")
        .addStringOption((opt) => opt.setName("phrase").setDescription("Word or phrase to look for in chat.").setRequired(true).setMaxLength(200))
        .addStringOption((opt) => opt.setName("response").setDescription("Message the bot should send.").setRequired(true).setMaxLength(1900))
        .addStringOption((opt) =>
          opt
            .setName("match")
            .setDescription("How the phrase should match.")
            .setRequired(false)
            .addChoices(
              { name: "contains", value: "contains" },
              { name: "whole-word", value: "word" },
              { name: "exact-message", value: "exact" }
            )
        )
        .addBooleanOption((opt) => opt.setName("case_sensitive").setDescription("Default: false.").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a phrase, or remove one response from a phrase.")
        .addStringOption((opt) => opt.setName("phrase").setDescription("Phrase to remove from.").setRequired(true))
        .addStringOption((opt) => opt.setName("response").setDescription("Optional exact response to remove.").setRequired(false))
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("List configured phrase triggers."))
    .addSubcommand((sub) => sub.setName("clear").setDescription("Remove all phrase triggers."))
    .addSubcommand((sub) => sub.setName("on").setDescription("Enable phrase-based bot messages."))
    .addSubcommand((sub) => sub.setName("off").setDescription("Disable phrase-based bot messages."))
    .addSubcommand((sub) => sub.setName("status").setDescription("Show autoresponse status."));

  return [autoreact.toJSON(), autoresponse.toJSON()];
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function registerCommandsForGuild(guild) {
  try {
    await guild.commands.set(buildCommands());
    console.log(`Registered commands for ${guild.name}`);
  } catch (err) {
    console.error(`Failed to register commands for ${guild.name}:`, err);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Loaded ${STANDARD_EMOJIS.length} standard Unicode emojis.`);
  for (const guild of client.guilds.cache.values()) {
    await registerCommandsForGuild(guild);
    await ensureGuildEmojiCache(guild);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  ensureGuildSettings(settings, guild.id);
  saveSettings();
  await registerCommandsForGuild(guild);
  await ensureGuildEmojiCache(guild);
});

client.on(Events.GuildEmojisUpdate, async (guild) => {
  await ensureGuildEmojiCache(guild);
});

async function handleAutoreactCommand(interaction) {
  const guildSettings = ensureGuildSettings(settings, interaction.guild.id);
  const sub = interaction.options.getSubcommand();

  if (sub.startsWith("whitelist")) {
    if (!(await requireManageWhitelist(interaction))) return;
  } else {
    if (!(await requireManageBot(interaction))) return;
  }

  if (["set", "save", "unsave", "remove", "react"].includes(sub)) {
    await ensureGuildEmojiCache(interaction.guild);
  }

  if (sub === "set") {
    const userInput = interaction.options.getString("users");
    const emojiInput = interaction.options.getString("emojis");
    const mode = interaction.options.getString("mode");

    const userIds = parseUserIds(userInput);
    const emojis = parseEmojiInput(emojiInput, interaction.guild);

    guildSettings.userIds = unique([...guildSettings.userIds, ...userIds]).slice(0, MAX_TARGET_USERS);
    guildSettings.selectedEmojis = unique([...guildSettings.selectedEmojis, ...emojis]).slice(0, MAX_SELECTED_EMOJIS);
    if (mode) guildSettings.mode = mode;
    guildSettings.enabled = true;
    guildSettings.updatedAt = new Date().toISOString();
    saveSettings();

    return interaction.reply({
      content: `Reaction settings updated. Targets: ${guildSettings.userIds.length}. Selected emojis: ${guildSettings.selectedEmojis.length}. Saved emojis: ${guildSettings.savedEmojis.length}. Mode: ${guildSettings.mode}.`,
      ephemeral: true,
    });
  }

  if (sub === "save") {
    const emojiInput = interaction.options.getString("emoji", true);
    const emojis = parseEmojiInput(emojiInput, interaction.guild);
    guildSettings.savedEmojis = unique([...guildSettings.savedEmojis, ...emojis]).slice(0, MAX_SAVED_EMOJIS);
    guildSettings.updatedAt = new Date().toISOString();
    saveSettings();

    return interaction.reply({
      content: `Saved ${emojis.length} emoji(s). Saved emoji total: ${guildSettings.savedEmojis.length}.`,
      ephemeral: true,
    });
  }

  if (sub === "unsave") {
    const emojiInput = interaction.options.getString("emoji", true);
    const emojis = parseEmojiInput(emojiInput, interaction.guild);
    guildSettings.savedEmojis = removeValues(guildSettings.savedEmojis, emojis);
    guildSettings.updatedAt = new Date().toISOString();
    saveSettings();

    return interaction.reply({
      content: `Removed ${emojis.length} emoji(s) from saved emojis. Saved emoji total: ${guildSettings.savedEmojis.length}.`,
      ephemeral: true,
    });
  }

  if (sub === "remove") {
    const userInput = interaction.options.getString("users");
    const selectedEmojiInput = interaction.options.getString("selected_emojis");

    const users = parseUserIds(userInput);
    const selectedEmojis = parseEmojiInput(selectedEmojiInput, interaction.guild);

    guildSettings.userIds = removeValues(guildSettings.userIds, users);
    guildSettings.selectedEmojis = removeValues(guildSettings.selectedEmojis, selectedEmojis);
    guildSettings.updatedAt = new Date().toISOString();
    saveSettings();

    return interaction.reply({
      content: `Removed requested values. Targets: ${guildSettings.userIds.length}. Selected emojis: ${guildSettings.selectedEmojis.length}.`,
      ephemeral: true,
    });
  }

  if (sub === "clear") {
    const target = interaction.options.getString("target", true);
    if (target === "target-users") guildSettings.userIds = [];
    if (target === "selected-emojis") guildSettings.selectedEmojis = [];
    if (target === "saved-emojis") guildSettings.savedEmojis = [];
    if (target === "all-reaction-settings") {
      guildSettings.userIds = [];
      guildSettings.selectedEmojis = [];
      guildSettings.savedEmojis = [];
      guildSettings.mode = "all-selected";
      guildSettings.enabled = false;
    }
    guildSettings.updatedAt = new Date().toISOString();
    saveSettings();

    return interaction.reply({ content: `Cleared: ${target}.`, ephemeral: true });
  }

  if (sub === "off") {
    guildSettings.enabled = false;
    saveSettings();
    return interaction.reply({ content: "Automatic reactions disabled. Saved settings were kept.", ephemeral: true });
  }

  if (sub === "on") {
    guildSettings.enabled = true;
    saveSettings();
    return interaction.reply({ content: "Automatic reactions enabled.", ephemeral: true });
  }

  if (sub === "status") {
    return interaction.reply({
      content:
        `Automatic reactions: ${guildSettings.enabled ? "on" : "off"}\n` +
        `Mode: ${guildSettings.mode}\n` +
        `Target users: ${guildSettings.userIds.length ? guildSettings.userIds.map((id) => `<@${id}>`).join(", ") : "none"}\n` +
        `Selected emojis: ${guildSettings.selectedEmojis.length ? guildSettings.selectedEmojis.join(" ") : "none"}\n` +
        `Saved emojis: ${guildSettings.savedEmojis.length ? guildSettings.savedEmojis.join(" ") : "none"}\n` +
        `Whitelisted users: ${guildSettings.whitelist.length ? guildSettings.whitelist.map((id) => `<@${id}>`).join(", ") : "none"}`,
      ephemeral: true,
    });
  }

  if (sub === "react") {
    const messageRef = interaction.options.getString("message", true);
    const source = interaction.options.getString("source", true);
    const typed = interaction.options.getString("emoji");
    const count = Math.min(interaction.options.getInteger("count") || 1, MAX_REACT_COUNT);

    const targetMessage = await fetchMessageFromReference(interaction, messageRef);
    if (!targetMessage) {
      return interaction.reply({ content: "I could not find that message. Use a message ID from this channel or a Discord message link.", ephemeral: true });
    }

    const emojis = await resolveManualReactionEmojis(interaction.guild, guildSettings, source, typed, count);
    if (!emojis.length) {
      return interaction.reply({ content: "No usable emojis were found for that source.", ephemeral: true });
    }

    const result = await addReactions(targetMessage, emojis);
    return interaction.reply({
      content: `Added ${result.ok} reaction(s). Failed: ${result.failed}.`,
      ephemeral: true,
    });
  }

  if (sub === "whitelist-add") {
    const userIds = parseUserIds(interaction.options.getString("users", true));
    guildSettings.whitelist = unique([...guildSettings.whitelist, ...userIds]);
    saveSettings();
    return interaction.reply({ content: `Whitelisted users: ${guildSettings.whitelist.map((id) => `<@${id}>`).join(", ") || "none"}`, ephemeral: true });
  }

  if (sub === "whitelist-remove") {
    const userIds = parseUserIds(interaction.options.getString("users", true));
    guildSettings.whitelist = removeValues(guildSettings.whitelist, userIds);
    saveSettings();
    return interaction.reply({ content: `Whitelisted users: ${guildSettings.whitelist.map((id) => `<@${id}>`).join(", ") || "none"}`, ephemeral: true });
  }

  if (sub === "whitelist-status") {
    return interaction.reply({ content: `Whitelisted users: ${guildSettings.whitelist.map((id) => `<@${id}>`).join(", ") || "none"}`, ephemeral: true });
  }

  if (sub === "whitelist-clear") {
    guildSettings.whitelist = [];
    saveSettings();
    return interaction.reply({ content: "Whitelist cleared.", ephemeral: true });
  }
}

async function handleAutoresponseCommand(interaction) {
  const guildSettings = ensureGuildSettings(settings, interaction.guild.id);
  const sub = interaction.options.getSubcommand();
  if (!(await requireManageBot(interaction))) return;

  if (sub === "add") {
    const phrase = interaction.options.getString("phrase", true).trim();
    const response = interaction.options.getString("response", true).trim();
    const match = interaction.options.getString("match") || "contains";
    const caseSensitive = interaction.options.getBoolean("case_sensitive") || false;

    if (!phrase || !response) {
      return interaction.reply({ content: "Phrase and response cannot be empty.", ephemeral: true });
    }

    let item = guildSettings.autoResponses.find((r) => samePhraseConfig(r, phrase, match, caseSensitive));
    if (!item) {
      if (guildSettings.autoResponses.length >= MAX_RESPONSES) {
        return interaction.reply({ content: `This server already has the maximum of ${MAX_RESPONSES} phrase triggers.`, ephemeral: true });
      }
      item = {
        id: makeId(),
        phrase,
        responses: [],
        match,
        caseSensitive,
        enabled: true,
        updatedAt: new Date().toISOString(),
      };
      guildSettings.autoResponses.push(item);
    }

    if (!item.responses.includes(response)) item.responses.push(response);
    item.responses = item.responses.slice(0, MAX_RESPONSES_PER_PHRASE);
    item.updatedAt = new Date().toISOString();
    guildSettings.autoResponsesEnabled = true;
    saveSettings();

    return interaction.reply({
      content: `Autoresponse saved. Phrase: "${phrase}". Responses for this phrase: ${item.responses.length}.`,
      ephemeral: true,
    });
  }

  if (sub === "remove") {
    const phrase = interaction.options.getString("phrase", true).trim();
    const response = interaction.options.getString("response");

    const before = guildSettings.autoResponses.length;
    for (const item of guildSettings.autoResponses) {
      if (normalizeForMatch(item.phrase, item.caseSensitive) === normalizeForMatch(phrase, item.caseSensitive)) {
        if (response) item.responses = item.responses.filter((r) => r !== response);
        else item.responses = [];
      }
    }
    guildSettings.autoResponses = guildSettings.autoResponses.filter((item) => item.responses.length > 0);
    saveSettings();

    const after = guildSettings.autoResponses.length;
    return interaction.reply({ content: `Autoresponse entries changed from ${before} to ${after}.`, ephemeral: true });
  }

  if (sub === "list") {
    if (!guildSettings.autoResponses.length) {
      return interaction.reply({ content: "No autoresponse phrases are configured.", ephemeral: true });
    }

    const lines = guildSettings.autoResponses.slice(0, 20).map((item, idx) => {
      return `${idx + 1}. "${item.phrase}" — ${item.responses.length} response(s), match: ${item.match}, case-sensitive: ${item.caseSensitive ? "yes" : "no"}`;
    });

    const extra = guildSettings.autoResponses.length > 20 ? `\n...and ${guildSettings.autoResponses.length - 20} more.` : "";
    return interaction.reply({ content: lines.join("\n") + extra, ephemeral: true });
  }

  if (sub === "clear") {
    guildSettings.autoResponses = [];
    saveSettings();
    return interaction.reply({ content: "All autoresponse phrases removed.", ephemeral: true });
  }

  if (sub === "on") {
    guildSettings.autoResponsesEnabled = true;
    saveSettings();
    return interaction.reply({ content: "Autoresponses enabled.", ephemeral: true });
  }

  if (sub === "off") {
    guildSettings.autoResponsesEnabled = false;
    saveSettings();
    return interaction.reply({ content: "Autoresponses disabled. Saved phrases were kept.", ephemeral: true });
  }

  if (sub === "status") {
    return interaction.reply({
      content: `Autoresponses: ${guildSettings.autoResponsesEnabled ? "on" : "off"}\nConfigured phrases: ${guildSettings.autoResponses.length}`,
      ephemeral: true,
    });
  }
}

function samePhraseConfig(item, phrase, match, caseSensitive) {
  return item.match === match &&
    item.caseSensitive === caseSensitive &&
    normalizeForMatch(item.phrase, caseSensitive) === normalizeForMatch(phrase, caseSensitive);
}

function normalizeForMatch(text, caseSensitive) {
  return caseSensitive ? String(text) : String(text).toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseMatches(content, item) {
  const text = normalizeForMatch(content, item.caseSensitive);
  const phrase = normalizeForMatch(item.phrase, item.caseSensitive);

  if (item.match === "exact") return text.trim() === phrase.trim();
  if (item.match === "word") {
    const re = new RegExp(`(^|\\W)${escapeRegExp(phrase)}(\\W|$)`, item.caseSensitive ? "u" : "iu");
    return re.test(content);
  }
  return text.includes(phrase);
}

function applyResponsePlaceholders(response, message) {
  return response
    .replaceAll("{user}", `<@${message.author.id}>`)
    .replaceAll("{username}", message.author.username)
    .replaceAll("{server}", message.guild?.name || "this server");
}

async function handleAutoResponses(message, guildSettings) {
  if (!guildSettings.autoResponsesEnabled) return;
  if (!message.content) return;
  if (!guildSettings.autoResponses.length) return;

  const matching = guildSettings.autoResponses.find((item) => item.enabled && phraseMatches(message.content, item));
  if (!matching) return;

  const response = randItem(matching.responses);
  if (!response) return;

  const finalResponse = applyResponsePlaceholders(response, message).slice(0, 2000);

  try {
    await message.channel.send({
      content: finalResponse,
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error(`Failed to send autoresponse in guild ${message.guild.id}, channel ${message.channel.id}:`, err.message);
  }
}

async function fetchMessageFromReference(interaction, ref) {
  try {
    const link = ref.match(/discord(?:app)?\.com\/channels\/(\d{17,20}|@me)\/(\d{17,20})\/(\d{17,20})/);
    let channelId;
    let messageId;

    if (link) {
      const guildId = link[1];
      if (guildId !== interaction.guild.id) return null;
      channelId = link[2];
      messageId = link[3];
    } else {
      channelId = interaction.channel.id;
      const idMatch = ref.match(/\b(\d{17,20})\b/);
      if (!idMatch) return null;
      messageId = idMatch[1];
    }

    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return null;
    return await channel.messages.fetch(messageId);
  } catch {
    return null;
  }
}

async function resolveManualReactionEmojis(guild, guildSettings, source, typed, count) {
  await ensureGuildEmojiCache(guild);

  if (source === "typed") return parseEmojiInput(typed, guild).slice(0, MAX_REACT_COUNT);
  if (source === "all-selected") return guildSettings.selectedEmojis.slice(0, MAX_REACT_COUNT);
  if (source === "all-saved") return guildSettings.savedEmojis.slice(0, MAX_REACT_COUNT);

  const pool = buildEmojiPool(guild, guildSettings, source.replace("random-", ""));
  const chosen = [];
  for (let i = 0; i < count; i++) {
    const emoji = randItem(pool);
    if (emoji && !chosen.includes(emoji)) chosen.push(emoji);
  }
  return chosen;
}

function getServerEmojiPool(guild) {
  return guild.emojis.cache.map(serverEmojiToReactionString);
}

function buildEmojiPool(guild, guildSettings, kind) {
  if (kind === "selected") return guildSettings.selectedEmojis;
  if (kind === "saved") return guildSettings.savedEmojis;
  if (kind === "standard") return STANDARD_EMOJIS;
  if (kind === "server") return getServerEmojiPool(guild);
  if (kind === "any") {
    return unique([
      ...guildSettings.selectedEmojis,
      ...guildSettings.savedEmojis,
      ...STANDARD_EMOJIS,
      ...getServerEmojiPool(guild),
    ]);
  }
  return [];
}

async function addReactions(message, emojis) {
  let ok = 0;
  let failed = 0;
  for (const emoji of unique(emojis).slice(0, MAX_REACT_COUNT)) {
    try {
      await message.react(emoji);
      ok++;
    } catch (err) {
      failed++;
      console.warn(`Failed to react with ${emoji}:`, err.message);
    }
  }
  return { ok, failed };
}

async function getAutoReactionEmojis(message, guildSettings) {
  const mode = guildSettings.mode || "all-selected";
  await ensureGuildEmojiCache(message.guild);

  if (mode === "all-selected") return guildSettings.selectedEmojis.slice(0, MAX_REACT_COUNT);
  if (mode === "all-saved") return guildSettings.savedEmojis.slice(0, MAX_REACT_COUNT);

  const kind = mode.replace("random-", "");
  const pool = buildEmojiPool(message.guild, guildSettings, kind);
  const emoji = randItem(pool);
  return emoji ? [emoji] : [];
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guild) {
    return interaction.reply({ content: "This command only works in a server.", ephemeral: true });
  }

  try {
    if (interaction.commandName === "autoreact") return await handleAutoreactCommand(interaction);
    if (interaction.commandName === "autoresponse") return await handleAutoresponseCommand(interaction);
  } catch (err) {
    console.error("Command error:", err);
    const message = "Command failed. Check Railway logs for details.";
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const guildSettings = ensureGuildSettings(settings, message.guild.id);

  // Phrase-based responses need Message Content Intent enabled in the Developer Portal and in code.
  await handleAutoResponses(message, guildSettings);

  if (!guildSettings.enabled) return;
  if (!guildSettings.userIds.includes(message.author.id)) return;

  const emojis = await getAutoReactionEmojis(message, guildSettings);
  if (!emojis.length) return;

  await addReactions(message, emojis);
});

client.login(TOKEN);
