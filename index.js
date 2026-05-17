const fs = require("fs");
const path = require("path");
const emojiData = require("emoji-datasource");

const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  throw new Error("Missing DISCORD_TOKEN environment variable.");
}

const DATA_DIR = process.env.DATA_DIR || "/data";
const FALLBACK_SETTINGS_PATH = path.join(__dirname, "settings.json");
let SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  SETTINGS_PATH = FALLBACK_SETTINGS_PATH;
}

const MAX_USERS = 50;
const MAX_SELECTED_EMOJIS = 50;
const MAX_SAVED_EMOJIS = 200;
const MAX_REACTIONS_PER_MESSAGE = 20; // Discord messages can have at most 20 different reactions.

function codepointsToEmoji(unified) {
  return unified
    .split("-")
    .map((hex) => String.fromCodePoint(parseInt(hex, 16)))
    .join("");
}

const STANDARD_EMOJIS = Array.from(
  new Set(
    emojiData
      .filter((item) => item && item.unified && !item.obsoleted_by)
      .map((item) => codepointsToEmoji(item.unified))
      .filter(Boolean)
  )
);

const MODE_CHOICES = [
  ["All selected emojis", "all-selected"],
  ["Random selected emoji", "random-selected"],
  ["All saved emojis", "all-saved"],
  ["Random saved emoji", "random-saved"],
  ["Random standard Discord emoji", "random-standard"],
  ["Random server emoji", "random-server"],
  ["Random selected/saved/standard/server emoji", "random-any"],
];

const MESSAGE_REACT_SOURCE_CHOICES = [
  ["Typed emoji(s)", "typed"],
  ["All selected emojis", "selected"],
  ["All saved emojis", "saved"],
  ["Random standard Discord emoji", "random-standard"],
  ["Random server emoji", "random-server"],
];

function emptyConfig() {
  return {
    enabled: true,
    targetUserIds: [],
    selectedEmojis: [],
    savedEmojis: [],
    whitelistUserIds: [],
    mode: "all-selected",
    updatedAt: new Date().toISOString(),
  };
}

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to load settings:", err);
    return {};
  }
}

function saveSettings(settings) {
  try {
    const dir = path.dirname(SETTINGS_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error("Failed to save settings:", err);
  }
}

function normalizeMode(mode) {
  if (!mode) return "all-selected";

  const aliases = {
    "all-configured": "all-saved",
    "random-configured": "random-saved",
    "configured": "random-saved",
    "saved": "random-saved",
    "all saved": "all-saved",
    "random saved": "random-saved",
    "all selected": "all-selected",
    "random selected": "random-selected",
  };

  return aliases[mode] || mode;
}

function normalizeConfig(input) {
  const cfg = { ...emptyConfig(), ...(input || {}) };

  const userIds = [];
  if (Array.isArray(input?.targetUserIds)) userIds.push(...input.targetUserIds);
  if (Array.isArray(input?.userIds)) userIds.push(...input.userIds);
  if (input?.userId) userIds.push(input.userId);

  const selectedEmojis = [];
  if (Array.isArray(input?.selectedEmojis)) selectedEmojis.push(...input.selectedEmojis);
  if (Array.isArray(input?.configuredEmojis)) selectedEmojis.push(...input.configuredEmojis);
  if (Array.isArray(input?.emojis)) selectedEmojis.push(...input.emojis);
  if (input?.emoji) selectedEmojis.push(input.emoji);

  const savedEmojis = [];
  if (Array.isArray(input?.savedEmojis)) savedEmojis.push(...input.savedEmojis);

  const whitelist = [];
  if (Array.isArray(input?.whitelistUserIds)) whitelist.push(...input.whitelistUserIds);
  if (Array.isArray(input?.whitelistedUserIds)) whitelist.push(...input.whitelistedUserIds);

  cfg.targetUserIds = uniqueList(userIds.map(String));
  cfg.selectedEmojis = uniqueList(selectedEmojis.map(String));
  cfg.savedEmojis = uniqueList(savedEmojis.map(String));
  cfg.whitelistUserIds = uniqueList(whitelist.map(String));
  cfg.mode = normalizeMode(input?.mode || cfg.mode);
  cfg.enabled = input?.enabled !== false;

  return cfg;
}

let settings = loadSettings();
for (const guildId of Object.keys(settings)) {
  settings[guildId] = normalizeConfig(settings[guildId]);
}
saveSettings(settings);

function getConfig(guildId) {
  if (!settings[guildId]) {
    settings[guildId] = emptyConfig();
  } else {
    settings[guildId] = normalizeConfig(settings[guildId]);
  }
  return settings[guildId];
}

function touchConfig(cfg) {
  cfg.updatedAt = new Date().toISOString();
}

function parseUserIds(input) {
  if (!input) return [];
  const ids = [];
  const regex = /<@!?(\d{15,25})>|\b(\d{15,25})\b/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    ids.push(match[1] || match[2]);
  }
  return uniqueList(ids);
}

function normalizeCustomEmojiToken(token, guild) {
  if (!token) return null;
  const trimmed = token.trim();
  if (!trimmed) return null;

  // Already in Discord's raw custom emoji format.
  const rawCustom = trimmed.match(/^<a?:([A-Za-z0-9_]+):(\d{15,25})>$/);
  if (rawCustom) return trimmed;

  // Name format, e.g. :party:
  const named = trimmed.match(/^:([A-Za-z0-9_]+):$/);
  if (named && guild) {
    const emoji = guild.emojis.cache.find((e) => e.name === named[1]);
    if (emoji) return emoji.toString();
    return trimmed;
  }

  return trimmed;
}

function parseEmojiInput(input, guild) {
  if (!input) return [];

  // Handles raw custom emojis, :serverEmojiName:, Unicode emoji clusters, and comma/space-separated text.
  const customRegex = /<a?:[A-Za-z0-9_]+:\d{15,25}>/gu;
  const serverNameRegex = /:[A-Za-z0-9_]+:/gu;
  const protectedTokens = [];
  let protectedInput = input.replace(customRegex, (m) => {
    const key = `__CUSTOM_${protectedTokens.length}__`;
    protectedTokens.push(m);
    return key;
  });
  protectedInput = protectedInput.replace(serverNameRegex, (m) => {
    const key = `__CUSTOM_${protectedTokens.length}__`;
    protectedTokens.push(m);
    return key;
  });

  const roughTokens = protectedInput
    .split(/[\s,]+/u)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const protectedMatch = t.match(/^__CUSTOM_(\d+)__$/);
      if (protectedMatch) return protectedTokens[Number(protectedMatch[1])];
      return t;
    });

  return uniqueList(
    roughTokens
      .map((token) => normalizeCustomEmojiToken(token, guild))
      .filter(Boolean)
  );
}

async function getServerEmojis(guild) {
  if (!guild) return [];
  try {
    await guild.emojis.fetch();
  } catch (err) {
    console.error(`Failed to fetch emojis for guild ${guild.id}:`, err);
  }

  return Array.from(guild.emojis.cache.values())
    .filter((emoji) => emoji.available !== false)
    .map((emoji) => emoji.toString());
}

function pickRandom(items) {
  if (!items.length) return null;
  return items[Math.floor(Math.random() * items.length)];
}

async function resolveModeEmojis(cfg, guild) {
  const selected = cfg.selectedEmojis || [];
  const saved = cfg.savedEmojis || [];

  switch (cfg.mode) {
    case "all-selected":
      return selected;
    case "random-selected":
      return [pickRandom(selected)].filter(Boolean);
    case "all-saved":
      return saved;
    case "random-saved":
      return [pickRandom(saved)].filter(Boolean);
    case "random-standard":
      return [pickRandom(STANDARD_EMOJIS)].filter(Boolean);
    case "random-server": {
      const serverEmojis = await getServerEmojis(guild);
      return [pickRandom(serverEmojis)].filter(Boolean);
    }
    case "random-any": {
      const serverEmojis = await getServerEmojis(guild);
      return [pickRandom([...selected, ...saved, ...STANDARD_EMOJIS, ...serverEmojis])].filter(Boolean);
    }
    default:
      return selected;
  }
}

async function addReactions(message, emojis) {
  const uniqueEmojis = uniqueList(emojis).slice(0, MAX_REACTIONS_PER_MESSAGE);
  const results = { added: [], failed: [] };

  for (const emoji of uniqueEmojis) {
    try {
      await message.react(emoji);
      results.added.push(emoji);
    } catch (err) {
      console.error(`Failed to react with ${emoji}:`, err?.message || err);
      results.failed.push(emoji);
    }
  }

  return results;
}

function isAdmin(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function isOwner(interaction) {
  return Boolean(interaction.guild && interaction.user.id === interaction.guild.ownerId);
}

function canManageWhitelist(interaction) {
  return isOwner(interaction) || isAdmin(interaction.member);
}

function canConfigure(interaction) {
  if (!interaction.guild) return false;
  if (canManageWhitelist(interaction)) return true;
  const cfg = getConfig(interaction.guild.id);
  return cfg.whitelistUserIds.includes(interaction.user.id);
}

function formatList(items, empty = "none") {
  if (!items || items.length === 0) return empty;
  const shown = items.slice(0, 25).join(", ");
  const extra = items.length > 25 ? `, ... +${items.length - 25} more` : "";
  return shown + extra;
}

function formatUserList(ids) {
  if (!ids || ids.length === 0) return "none";
  return ids.slice(0, 25).map((id) => `<@${id}>`).join(", ") + (ids.length > 25 ? `, ... +${ids.length - 25} more` : "");
}

function parseDiscordMessageReference(input) {
  const raw = input.trim();
  const link = raw.match(/discord(?:app)?\.com\/channels\/(\d{15,25}|@me)\/(\d{15,25})\/(\d{15,25})/i);
  if (link) {
    return { guildId: link[1], channelId: link[2], messageId: link[3] };
  }

  const id = raw.match(/\b(\d{15,25})\b/);
  if (id) return { messageId: id[1] };

  return null;
}

async function fetchMessageForInteraction(interaction, messageRefInput) {
  const ref = parseDiscordMessageReference(messageRefInput);
  if (!ref) throw new Error("Invalid message ID or Discord message link.");

  let channel = interaction.channel;

  if (ref.channelId) {
    channel = await interaction.client.channels.fetch(ref.channelId);
    if (!channel) throw new Error("Could not find the channel in that message link.");
  }

  if (!channel || !channel.messages?.fetch) {
    throw new Error("This command must be used in a text channel, or you must provide a valid message link.");
  }

  return await channel.messages.fetch(ref.messageId);
}

const commandBuilder = new SlashCommandBuilder()
  .setName("autoreact")
  .setDescription("Configure automatic reactions for this server.")
  .addSubcommand((sub) =>
    sub
      .setName("set")
      .setDescription("Add target users, add selected emojis, and/or change the reaction mode.")
      .addStringOption((opt) =>
        opt
          .setName("users")
          .setDescription("User mentions or IDs to add, e.g. @UserOne @UserTwo")
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName("emojis")
          .setDescription("Selected emojis for selected modes, e.g. 👍, 😂, :serverEmoji:")
          .setRequired(false)
      )
      .addStringOption((opt) => {
        opt
          .setName("mode")
          .setDescription("How the bot chooses reactions.")
          .setRequired(false);
        for (const [name, value] of MODE_CHOICES) opt.addChoices({ name, value });
        return opt;
      })
  )
  .addSubcommand((sub) =>
    sub
      .setName("save")
      .setDescription("Save emoji(s) into the reusable saved emoji pool.")
      .addStringOption((opt) =>
        opt
          .setName("emoji")
          .setDescription("Emoji(s) to save, e.g. 👍, 😂, :serverEmoji:")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("unsave")
      .setDescription("Remove emoji(s) from the reusable saved emoji pool.")
      .addStringOption((opt) =>
        opt
          .setName("emoji")
          .setDescription("Emoji(s) to remove from saved emojis.")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("react")
      .setDescription("Add reaction(s) to a specific existing message.")
      .addStringOption((opt) =>
        opt
          .setName("message")
          .setDescription("Message ID or Discord message link.")
          .setRequired(true)
      )
      .addStringOption((opt) => {
        opt
          .setName("source")
          .setDescription("Which emoji source to use.")
          .setRequired(true);
        for (const [name, value] of MESSAGE_REACT_SOURCE_CHOICES) opt.addChoices({ name, value });
        return opt;
      })
      .addStringOption((opt) =>
        opt
          .setName("emoji")
          .setDescription("Required only when source is Typed emoji(s). Example: 👍, 😂, :serverEmoji:")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove target users and/or selected emojis.")
      .addStringOption((opt) =>
        opt
          .setName("users")
          .setDescription("User mentions or IDs to remove.")
          .setRequired(false)
      )
      .addStringOption((opt) =>
        opt
          .setName("emojis")
          .setDescription("Selected emojis to remove.")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("clear")
      .setDescription("Clear one stored list.")
      .addStringOption((opt) =>
        opt
          .setName("target")
          .setDescription("What to clear.")
          .setRequired(true)
          .addChoices(
            { name: "Target users", value: "users" },
            { name: "Selected emojis", value: "selected-emojis" },
            { name: "Saved emojis", value: "saved-emojis" },
            { name: "All reaction settings except whitelist", value: "reaction-settings" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("Show the current configuration.")
  )
  .addSubcommand((sub) =>
    sub.setName("off").setDescription("Disable automatic reactions without clearing whitelist.")
  )
  .addSubcommand((sub) =>
    sub.setName("on").setDescription("Enable automatic reactions again.")
  )
  .addSubcommand((sub) =>
    sub
      .setName("whitelist-add")
      .setDescription("Allow non-admin users to configure the bot.")
      .addStringOption((opt) =>
        opt
          .setName("users")
          .setDescription("User mentions or IDs to whitelist.")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("whitelist-remove")
      .setDescription("Remove users from the bot command whitelist.")
      .addStringOption((opt) =>
        opt
          .setName("users")
          .setDescription("User mentions or IDs to remove from whitelist.")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("whitelist-status").setDescription("Show whitelisted members.")
  )
  .addSubcommand((sub) =>
    sub.setName("whitelist-clear").setDescription("Clear the command whitelist.")
  );

const commands = [commandBuilder.toJSON()];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

async function registerCommandsForGuild(guild) {
  try {
    await guild.commands.set(commands);
    console.log(`Registered commands for ${guild.name}`);
  } catch (err) {
    console.error(`Failed to register commands for ${guild.name}:`, err);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Loaded ${STANDARD_EMOJIS.length} standard emojis.`);
  console.log(`Settings path: ${SETTINGS_PATH}`);

  for (const guild of client.guilds.cache.values()) {
    await registerCommandsForGuild(guild);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  await registerCommandsForGuild(guild);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "autoreact") return;

  if (!interaction.guild) {
    return interaction.reply({
      content: "This command only works in a server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const cfg = getConfig(guildId);

  const whitelistManagementCommands = new Set([
    "whitelist-add",
    "whitelist-remove",
    "whitelist-clear",
  ]);

  if (whitelistManagementCommands.has(subcommand)) {
    if (!canManageWhitelist(interaction)) {
      return interaction.reply({
        content: "Only the server owner or members with Administrator can manage the bot whitelist.",
        flags: MessageFlags.Ephemeral,
      });
    }
  } else if (!canConfigure(interaction)) {
    return interaction.reply({
      content: "You do not have permission to use this bot command. Ask the server owner or an Administrator to whitelist you.",
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    if (subcommand === "set") {
      const usersInput = interaction.options.getString("users");
      const emojisInput = interaction.options.getString("emojis");
      const mode = interaction.options.getString("mode");

      const userIds = parseUserIds(usersInput);
      const selectedEmojis = parseEmojiInput(emojisInput, interaction.guild);

      if (!userIds.length && !selectedEmojis.length && !mode) {
        return interaction.reply({
          content: "Nothing to update. Provide users, emojis, mode, or any combination of those.",
          flags: MessageFlags.Ephemeral,
        });
      }

      cfg.targetUserIds = uniqueList([...cfg.targetUserIds, ...userIds]).slice(0, MAX_USERS);
      cfg.selectedEmojis = uniqueList([...cfg.selectedEmojis, ...selectedEmojis]).slice(0, MAX_SELECTED_EMOJIS);
      if (mode) cfg.mode = normalizeMode(mode);
      cfg.enabled = true;
      touchConfig(cfg);
      saveSettings(settings);

      return interaction.reply({
        content:
          `Updated auto-react settings.\n` +
          `Mode: ${cfg.mode}\n` +
          `Target users: ${formatUserList(cfg.targetUserIds)}\n` +
          `Selected emojis: ${formatList(cfg.selectedEmojis)}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "save") {
      const emojiInput = interaction.options.getString("emoji", true);
      const emojis = parseEmojiInput(emojiInput, interaction.guild);

      if (!emojis.length) {
        return interaction.reply({
          content: "No valid emoji was found in that input.",
          flags: MessageFlags.Ephemeral,
        });
      }

      cfg.savedEmojis = uniqueList([...cfg.savedEmojis, ...emojis]).slice(0, MAX_SAVED_EMOJIS);
      touchConfig(cfg);
      saveSettings(settings);

      return interaction.reply({
        content: `Saved emoji pool updated: ${formatList(cfg.savedEmojis)}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "unsave") {
      const emojiInput = interaction.options.getString("emoji", true);
      const emojis = parseEmojiInput(emojiInput, interaction.guild);
      const removeSet = new Set(emojis);
      cfg.savedEmojis = cfg.savedEmojis.filter((emoji) => !removeSet.has(emoji));
      touchConfig(cfg);
      saveSettings(settings);

      return interaction.reply({
        content: `Saved emoji pool updated: ${formatList(cfg.savedEmojis)}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "react") {
      const messageInput = interaction.options.getString("message", true);
      const source = interaction.options.getString("source", true);
      const emojiInput = interaction.options.getString("emoji");

      let emojis = [];
      if (source === "typed") {
        emojis = parseEmojiInput(emojiInput, interaction.guild);
        if (!emojis.length) {
          return interaction.reply({
            content: "Provide emoji when source is Typed emoji(s).",
            flags: MessageFlags.Ephemeral,
          });
        }
      } else if (source === "selected") {
        emojis = cfg.selectedEmojis;
      } else if (source === "saved") {
        emojis = cfg.savedEmojis;
      } else if (source === "random-standard") {
        emojis = [pickRandom(STANDARD_EMOJIS)].filter(Boolean);
      } else if (source === "random-server") {
        const serverEmojis = await getServerEmojis(interaction.guild);
        emojis = [pickRandom(serverEmojis)].filter(Boolean);
      }

      if (!emojis.length) {
        return interaction.reply({
          content: `No emojis are available for source: ${source}`,
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const targetMessage = await fetchMessageForInteraction(interaction, messageInput);
      const result = await addReactions(targetMessage, emojis);

      return interaction.editReply({
        content:
          `Added ${result.added.length} reaction(s) to the message.` +
          (result.failed.length ? ` Failed: ${formatList(result.failed)}` : ""),
      });
    }

    if (subcommand === "remove") {
      const usersInput = interaction.options.getString("users");
      const emojisInput = interaction.options.getString("emojis");
      const userIds = parseUserIds(usersInput);
      const selectedEmojis = parseEmojiInput(emojisInput, interaction.guild);
      const userRemoveSet = new Set(userIds);
      const emojiRemoveSet = new Set(selectedEmojis);

      cfg.targetUserIds = cfg.targetUserIds.filter((id) => !userRemoveSet.has(id));
      cfg.selectedEmojis = cfg.selectedEmojis.filter((emoji) => !emojiRemoveSet.has(emoji));
      touchConfig(cfg);
      saveSettings(settings);

      return interaction.reply({
        content:
          `Updated auto-react settings.\n` +
          `Target users: ${formatUserList(cfg.targetUserIds)}\n` +
          `Selected emojis: ${formatList(cfg.selectedEmojis)}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "clear") {
      const target = interaction.options.getString("target", true);

      if (target === "users") cfg.targetUserIds = [];
      if (target === "selected-emojis") cfg.selectedEmojis = [];
      if (target === "saved-emojis") cfg.savedEmojis = [];
      if (target === "reaction-settings") {
        cfg.enabled = false;
        cfg.targetUserIds = [];
        cfg.selectedEmojis = [];
        cfg.savedEmojis = [];
        cfg.mode = "all-selected";
      }

      touchConfig(cfg);
      saveSettings(settings);

      return interaction.reply({
        content: `Cleared: ${target}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "status") {
      const serverEmojis = await getServerEmojis(interaction.guild);
      return interaction.reply({
        content:
          `Enabled: ${cfg.enabled ? "yes" : "no"}\n` +
          `Mode: ${cfg.mode}\n` +
          `Target users: ${formatUserList(cfg.targetUserIds)}\n` +
          `Selected emojis: ${formatList(cfg.selectedEmojis)}\n` +
          `Saved emojis: ${formatList(cfg.savedEmojis)}\n` +
          `Server emoji pool: ${serverEmojis.length} emoji(s) available\n` +
          `Standard emoji pool: ${STANDARD_EMOJIS.length} emoji(s) available\n` +
          `Whitelisted users: ${formatUserList(cfg.whitelistUserIds)}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "off") {
      cfg.enabled = false;
      touchConfig(cfg);
      saveSettings(settings);

      return interaction.reply({
        content: "Automatic reactions are now disabled. Saved users, selected emojis, saved emojis, and whitelist were kept.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "on") {
      cfg.enabled = true;
      touchConfig(cfg);
      saveSettings(settings);

      return interaction.reply({
        content: "Automatic reactions are now enabled.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "whitelist-add") {
      const userIds = parseUserIds(interaction.options.getString("users", true));
      if (!userIds.length) {
        return interaction.reply({
          content: "No user IDs or mentions were found.",
          flags: MessageFlags.Ephemeral,
        });
      }
      cfg.whitelistUserIds = uniqueList([...cfg.whitelistUserIds, ...userIds]);
      touchConfig(cfg);
      saveSettings(settings);

      return interaction.reply({
        content: `Whitelisted users: ${formatUserList(cfg.whitelistUserIds)}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "whitelist-remove") {
      const userIds = parseUserIds(interaction.options.getString("users", true));
      const removeSet = new Set(userIds);
      cfg.whitelistUserIds = cfg.whitelistUserIds.filter((id) => !removeSet.has(id));
      touchConfig(cfg);
      saveSettings(settings);

      return interaction.reply({
        content: `Whitelisted users: ${formatUserList(cfg.whitelistUserIds)}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "whitelist-status") {
      return interaction.reply({
        content: `Whitelisted users: ${formatUserList(cfg.whitelistUserIds)}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === "whitelist-clear") {
      cfg.whitelistUserIds = [];
      touchConfig(cfg);
      saveSettings(settings);

      return interaction.reply({
        content: "Whitelist cleared.",
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    console.error(`Command ${subcommand} failed:`, err);
    const content = `Command failed: ${err.message || "Unknown error"}`;
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ content });
    }
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const cfg = getConfig(message.guild.id);
  if (!cfg.enabled) return;
  if (!cfg.targetUserIds.includes(message.author.id)) return;

  const emojis = await resolveModeEmojis(cfg, message.guild);
  if (!emojis.length) return;

  await addReactions(message, emojis);
});

client.login(TOKEN);
