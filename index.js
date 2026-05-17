const fs = require("fs");
const path = require("path");

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

// Railway: create a Volume mounted at /data so settings survive restarts/redeploys.
// If /data is unavailable, the bot falls back to local storage, which may reset on redeploy.
const DATA_DIR = process.env.DATA_DIR || (fs.existsSync("/data") ? "/data" : __dirname);
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");
const MAX_USERS = 50;
const MAX_EMOJIS = 20;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadSettings() {
  try {
    ensureDataDir();
    if (!fs.existsSync(SETTINGS_PATH)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch (err) {
    console.error("Could not load settings:", err);
    return {};
  }
}

function saveSettings(settings) {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function uniquePush(array, value) {
  if (!array.includes(value)) array.push(value);
}

function parseUserIds(input) {
  const ids = [];
  const regex = /<@!?(\d{17,20})>|\b(\d{17,20})\b/g;
  let match;

  while ((match = regex.exec(input)) !== null) {
    const id = match[1] || match[2];
    uniquePush(ids, id);
  }

  return ids.slice(0, MAX_USERS);
}

async function getGuildEmojiCache(guild) {
  try {
    return await guild.emojis.fetch();
  } catch (err) {
    console.warn(`Could not fetch emojis for guild=${guild.id}:`, err.message || err);
    return guild.emojis.cache;
  }
}

async function resolveEmojiToken(rawToken, guild) {
  const token = rawToken.trim();
  if (!token) return null;

  // Custom emoji pasted from Discord, e.g. <:party:123456789012345678>
  // or animated custom emoji, e.g. <a:dance:123456789012345678>
  if (/^<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>$/.test(token)) {
    return { emoji: token, warning: null };
  }

  // Server emoji shorthand by name, e.g. :party:
  const serverEmojiName = token.match(/^:([A-Za-z0-9_]{2,32}):$/)?.[1];
  if (serverEmojiName) {
    const guildEmojis = await getGuildEmojiCache(guild);
    const found = guildEmojis.find((emoji) => emoji.name === serverEmojiName);

    if (!found) {
      return {
        emoji: null,
        warning: `Could not find a server emoji named :${serverEmojiName}:.`,
      };
    }

    return { emoji: found.toString(), warning: null };
  }

  // Unicode emoji, e.g. 👍, 😂, 🫡. Discord.js will validate when reacting.
  return { emoji: token, warning: null };
}

async function parseEmojiList(input, guild) {
  const separator = input.includes(",") ? /,/ : /\s+/;
  const rawTokens = input
    .split(separator)
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);

  const emojis = [];
  const warnings = [];

  for (const rawToken of rawTokens) {
    const result = await resolveEmojiToken(rawToken, guild);
    if (result?.emoji) uniquePush(emojis, result.emoji);
    if (result?.warning) warnings.push(result.warning);
  }

  return {
    emojis: emojis.slice(0, MAX_EMOJIS),
    warnings,
    truncated: rawTokens.length > MAX_EMOJIS,
  };
}

function normalizeSetting(setting) {
  // Migrates the old one-user/one-emoji format without requiring manual deletion.
  if (setting?.userId && setting?.emoji) {
    return {
      version: 2,
      userIds: [setting.userId],
      emojis: [setting.emoji],
      mode: "all",
      updatedAt: setting.updatedAt || new Date().toISOString(),
    };
  }

  if (!setting || !Array.isArray(setting.userIds) || !Array.isArray(setting.emojis)) {
    return null;
  }

  return {
    version: 2,
    userIds: setting.userIds.map(String),
    emojis: setting.emojis.map(String),
    mode: setting.mode === "random" ? "random" : "all",
    updatedAt: setting.updatedAt || new Date().toISOString(),
  };
}

function summarizeList(items, formatter = (item) => item, maxShown = 8) {
  const shown = items.slice(0, maxShown).map(formatter);
  const extra = items.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} and ${extra} more` : shown.join(", ");
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function tryReact(message, emoji) {
  try {
    await message.react(emoji);
    return true;
  } catch (err) {
    console.error(
      `Failed to react with ${emoji} in guild=${message.guild.id} channel=${message.channel.id} message=${message.id}`,
      err.message || err
    );
    return false;
  }
}

async function reactToMessage(message, setting) {
  if (setting.mode === "random") {
    // If the first random emoji fails, try the rest in random order before giving up.
    const first = pickRandom(setting.emojis);
    const rest = shuffled(setting.emojis.filter((emoji) => emoji !== first));

    for (const emoji of [first, ...rest]) {
      if (await tryReact(message, emoji)) return;
    }

    return;
  }

  // Default mode: add every configured emoji.
  for (const emoji of setting.emojis) {
    await tryReact(message, emoji);
  }
}

let settings = loadSettings();

const commands = [
  new SlashCommandBuilder()
    .setName("autoreact")
    .setDescription("Configure automatic reactions for this server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("React to messages from one or more users.")
        .addStringOption((opt) =>
          opt
            .setName("users")
            .setDescription("Mention users or paste user IDs, separated by spaces or commas.")
            .setRequired(true)
            .setMaxLength(1500)
        )
        .addStringOption((opt) =>
          opt
            .setName("emojis")
            .setDescription("Comma-separated emojis: 👍, 😂, <:name:id>, or :serverEmojiName:.")
            .setRequired(true)
            .setMaxLength(1000)
        )
        .addStringOption((opt) =>
          opt
            .setName("mode")
            .setDescription("React with every configured emoji, or pick one randomly.")
            .setRequired(false)
            .addChoices(
              { name: "all - react with every emoji", value: "all" },
              { name: "random - pick one emoji each time", value: "random" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub.setName("off").setDescription("Disable automatic reactions in this server.")
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Show the current automatic reaction setting.")
    ),
].map((cmd) => cmd.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildEmojisAndStickers,
  ],
});

async function registerCommandsForGuild(guild) {
  try {
    await guild.commands.set(commands);
    console.log(`Registered /autoreact for ${guild.name}`);
  } catch (err) {
    console.error(`Failed to register commands for ${guild.name}:`, err);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
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

  // Server-owner controlled: only the owner of this Discord server may change settings.
  if (interaction.user.id !== interaction.guild.ownerId) {
    return interaction.reply({
      content: "Only the server owner can configure this bot.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (subcommand === "set") {
    const usersInput = interaction.options.getString("users", true);
    const emojisInput = interaction.options.getString("emojis", true);
    const mode = interaction.options.getString("mode") || "all";

    const userIds = parseUserIds(usersInput);
    if (userIds.length === 0) {
      return interaction.reply({
        content: "No users found. Mention users like @Name, or paste Discord user IDs.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const parsedEmojis = await parseEmojiList(emojisInput, interaction.guild);
    if (parsedEmojis.emojis.length === 0) {
      return interaction.reply({
        content:
          "No usable emojis found. Use Unicode emojis, paste custom emojis, or use server emoji names like :party:.",
        flags: MessageFlags.Ephemeral,
      });
    }

    settings[guildId] = {
      version: 2,
      userIds,
      emojis: parsedEmojis.emojis,
      mode: mode === "random" ? "random" : "all",
      updatedAt: new Date().toISOString(),
    };

    saveSettings(settings);

    const warnings = [];
    if (userIds.length >= MAX_USERS) warnings.push(`Only the first ${MAX_USERS} users were saved.`);
    if (parsedEmojis.truncated) warnings.push(`Only the first ${MAX_EMOJIS} emojis were saved.`);
    warnings.push(...parsedEmojis.warnings);

    return interaction.reply({
      content: [
        `Enabled for ${userIds.length} user(s): ${summarizeList(userIds, (id) => `<@${id}>`)}.`,
        `Mode: ${settings[guildId].mode}.`,
        `Emojis: ${summarizeList(parsedEmojis.emojis)}.`,
        warnings.length ? `Warnings: ${warnings.join(" ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "off") {
    delete settings[guildId];
    saveSettings(settings);

    return interaction.reply({
      content: "Disabled automatic reactions for this server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "status") {
    const current = normalizeSetting(settings[guildId]);

    if (!current) {
      return interaction.reply({
        content: "Automatic reactions are currently disabled for this server.",
        flags: MessageFlags.Ephemeral,
      });
    }

    return interaction.reply({
      content: [
        `Enabled for ${current.userIds.length} user(s): ${summarizeList(current.userIds, (id) => `<@${id}>`)}.`,
        `Mode: ${current.mode}.`,
        `Emojis: ${summarizeList(current.emojis)}.`,
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const current = normalizeSetting(settings[message.guild.id]);
  if (!current) return;

  if (!current.userIds.includes(message.author.id)) return;
  if (current.emojis.length === 0) return;

  await reactToMessage(message, current);
});

client.login(TOKEN);
