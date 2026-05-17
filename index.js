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

const SETTINGS_VERSION = 3;
const MAX_USERS = 100;
const MAX_CONFIGURED_EMOJIS = 100;
const MAX_REACTIONS_PER_MESSAGE = 20;
const RANDOM_REACTION_ATTEMPTS = 12;

const MODE_CHOICES = [
  {
    name: "all-configured - react with every saved emoji",
    value: "all_configured",
  },
  {
    name: "random-configured - pick one saved emoji",
    value: "random_configured",
  },
  {
    name: "random-standard - pick from all standard Discord emojis",
    value: "random_standard",
  },
  {
    name: "random-server - pick from this server's emojis",
    value: "random_server",
  },
  {
    name: "random-any - saved + standard + server emojis",
    value: "random_any",
  },
];

const VALID_MODES = new Set(MODE_CHOICES.map((choice) => choice.value));

// Fallback only. The full standard emoji list is loaded from emoji-datasource when installed.
const FALLBACK_STANDARD_EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥲", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗", "🤔", "🫡", "🤭", "🫢", "🫣", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😮‍💨", "😵", "😵‍💫", "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿", "👹", "👺", "🤡", "💩", "👻", "💀", "☠️", "👽", "👾", "🤖", "🎃", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾",
  "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "🫵", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🦾", "🦿", "🦵", "🦶", "👂", "🦻", "👃", "🧠", "🫀", "🫁", "🦷", "🦴", "👀", "👁️", "👅", "👄", "🫦",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "☮️", "✝️", "☪️", "🕉️", "☸️", "✡️", "🔯", "🕎", "☯️", "☦️", "🛐", "⛎", "♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓", "🆔", "⚛️", "🉑", "☢️", "☣️", "📴", "📳", "🈶", "🈚", "🈸", "🈺", "🈷️", "✴️", "🆚", "💮", "🉐", "㊙️", "㊗️", "🈴", "🈵", "🈹", "🈲", "🅰️", "🅱️", "🆎", "🆑", "🅾️", "🆘", "❌", "⭕", "🛑", "⛔", "📛", "🚫", "💯", "💢", "♨️", "🚷", "🚯", "🚳", "🚱", "🔞", "📵", "🚭", "❗", "❕", "❓", "❔", "‼️", "⁉️", "🔅", "🔆", "〽️", "⚠️", "🚸", "🔱", "⚜️", "🔰", "♻️", "✅", "🈯", "💹", "❇️", "✳️", "❎", "🌐", "💠", "Ⓜ️", "🌀", "💤", "🏧", "🚾", "♿", "🅿️", "🛗", "🈳", "🈂️", "🛂", "🛃", "🛄", "🛅", "🚹", "🚺", "🚼", "⚧️", "🚻", "🚮", "🎦", "📶", "🈁", "🔣", "ℹ️", "🔤", "🔡", "🔠", "🆖", "🆗", "🆙", "🆒", "🆕", "🆓", "0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟",
  "🔥", "✨", "🌟", "⭐", "💫", "💥", "💨", "💦", "💧", "🌊", "🎉", "🎊", "🎈", "🎁", "🏆", "🥇", "🥈", "🥉", "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏉", "🎱", "🏓", "🏸", "🥅", "🏒", "🏑", "🏏", "⛳", "🏹", "🎣", "🤿", "🥊", "🥋", "🎽", "🛹", "🛼", "🛷", "⛸️", "🥌", "🎿", "⛷️", "🏂", "🪂", "🏋️", "🤼", "🤸", "⛹️", "🤺", "🤾", "🏌️", "🏇", "🧘", "🏄", "🏊", "🤽", "🚣", "🧗", "🚵", "🚴", "🏁", "🚩", "🎌", "🏴", "🏳️", "🏳️‍🌈", "🏳️‍⚧️", "🏴‍☠️"
];

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

function uniqueArray(values) {
  const result = [];
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") uniquePush(result, String(value));
  }
  return result;
}

function removeItems(array, valuesToRemove) {
  const removalSet = new Set(valuesToRemove.map(String));
  return array.filter((value) => !removalSet.has(String(value)));
}

function parseUserIds(input) {
  if (!input) return [];

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

async function getGuildReactionEmojis(guild) {
  const guildEmojis = await getGuildEmojiCache(guild);
  const result = [];

  for (const emoji of guildEmojis.values()) {
    if (emoji.available === false) continue;
    uniquePush(result, emoji.toString());
  }

  return result;
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

    if (found.available === false) {
      return {
        emoji: null,
        warning: `Server emoji :${serverEmojiName}: is not currently available to the bot.`,
      };
    }

    return { emoji: found.toString(), warning: null };
  }

  // Unicode emoji, e.g. 👍, 😂, 🫡. Discord.js will validate when reacting.
  return { emoji: token, warning: null };
}

async function parseEmojiList(input, guild) {
  if (!input) {
    return { emojis: [], warnings: [], truncated: false };
  }

  const separator = input.includes(",") ? /,/ : /\s+/;
  const rawTokens = input
    .split(separator)
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  const emojis = [];
  const warnings = [];

  for (const rawToken of rawTokens) {
    const result = await resolveEmojiToken(rawToken, guild);
    if (result?.emoji) uniquePush(emojis, result.emoji);
    if (result?.warning) warnings.push(result.warning);
  }

  return {
    emojis: emojis.slice(0, MAX_CONFIGURED_EMOJIS),
    warnings,
    truncated: rawTokens.length > MAX_CONFIGURED_EMOJIS,
  };
}

function unifiedToEmoji(unified) {
  try {
    return unified
      .split("-")
      .map((hex) => String.fromCodePoint(parseInt(hex, 16)))
      .join("");
  } catch {
    return null;
  }
}

function loadStandardEmojis() {
  try {
    // Loaded from the npm package declared in package.json.
    // emoji.json is the documented data file; emoji_pretty.json is kept as a fallback.
    let data;
    try {
      data = require("emoji-datasource/emoji.json");
    } catch {
      data = require("emoji-datasource/emoji_pretty.json");
    }

    const emojis = [];

    for (const entry of data) {
      if (!entry?.unified) continue;
      if (entry.category === "Skin Tones" || entry.category === "Component") continue;

      const emoji = unifiedToEmoji(entry.unified);
      if (emoji) uniquePush(emojis, emoji);

      // Include standard skin-tone variants where the datasource provides them.
      if (entry.skin_variations && typeof entry.skin_variations === "object") {
        for (const variation of Object.values(entry.skin_variations)) {
          const variantEmoji = variation?.unified ? unifiedToEmoji(variation.unified) : null;
          if (variantEmoji) uniquePush(emojis, variantEmoji);
        }
      }
    }

    if (emojis.length > 0) return emojis;
  } catch (err) {
    console.warn("Could not load emoji-datasource. Using fallback standard emoji list.", err.message || err);
  }

  return uniqueArray(FALLBACK_STANDARD_EMOJIS);
}

const STANDARD_EMOJIS = loadStandardEmojis();

function normalizeMode(mode) {
  if (mode === "all") return "all_configured";
  if (mode === "random") return "random_configured";
  if (VALID_MODES.has(mode)) return mode;
  return "all_configured";
}

function emptySetting() {
  return {
    version: SETTINGS_VERSION,
    userIds: [],
    emojis: [],
    mode: "all_configured",
    updatedAt: new Date().toISOString(),
  };
}

function normalizeSetting(setting) {
  // Migrates the original one-user/one-emoji format.
  if (setting?.userId && setting?.emoji) {
    return {
      version: SETTINGS_VERSION,
      userIds: [String(setting.userId)],
      emojis: [String(setting.emoji)],
      mode: "all_configured",
      updatedAt: setting.updatedAt || new Date().toISOString(),
    };
  }

  if (!setting || (!Array.isArray(setting.userIds) && !Array.isArray(setting.emojis))) {
    return null;
  }

  return {
    version: SETTINGS_VERSION,
    userIds: uniqueArray(Array.isArray(setting.userIds) ? setting.userIds : []).slice(0, MAX_USERS),
    emojis: uniqueArray(Array.isArray(setting.emojis) ? setting.emojis : []).slice(0, MAX_CONFIGURED_EMOJIS),
    mode: normalizeMode(setting.mode),
    updatedAt: setting.updatedAt || new Date().toISOString(),
  };
}

function summarizeList(items, formatter = (item) => item, maxShown = 8) {
  if (!items || items.length === 0) return "none";
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

async function getRandomEmojiPool(message, setting) {
  if (setting.mode === "random_configured") {
    return setting.emojis;
  }

  if (setting.mode === "random_standard") {
    return STANDARD_EMOJIS;
  }

  if (setting.mode === "random_server") {
    return await getGuildReactionEmojis(message.guild);
  }

  if (setting.mode === "random_any") {
    const serverEmojis = await getGuildReactionEmojis(message.guild);
    return uniqueArray([...setting.emojis, ...STANDARD_EMOJIS, ...serverEmojis]);
  }

  return [];
}

async function reactRandomly(message, setting) {
  const pool = await getRandomEmojiPool(message, setting);
  if (!pool || pool.length === 0) return;

  const first = pickRandom(pool);
  const rest = shuffled(pool.filter((emoji) => emoji !== first));
  const attempts = [first, ...rest].slice(0, RANDOM_REACTION_ATTEMPTS);

  for (const emoji of attempts) {
    if (await tryReact(message, emoji)) return;
  }
}

async function reactToMessage(message, setting) {
  if (setting.mode === "all_configured") {
    // A Discord message can only carry a limited number of distinct reaction types.
    // This cap also prevents accidental mass reaction spam.
    for (const emoji of setting.emojis.slice(0, MAX_REACTIONS_PER_MESSAGE)) {
      await tryReact(message, emoji);
    }
    return;
  }

  await reactRandomly(message, setting);
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
        .setDescription("Add users/emojis or change mode without removing existing settings.")
        .addStringOption((opt) =>
          opt
            .setName("users")
            .setDescription("Users to add. Mention users or paste IDs, separated by spaces or commas.")
            .setRequired(false)
            .setMaxLength(1500)
        )
        .addStringOption((opt) =>
          opt
            .setName("emojis")
            .setDescription("Emojis to add: 👍, <:name:id>, or :serverEmojiName:. Optional for standard/server modes.")
            .setRequired(false)
            .setMaxLength(1500)
        )
        .addStringOption((opt) =>
          opt
            .setName("mode")
            .setDescription("How the bot chooses reactions.")
            .setRequired(false)
            .addChoices(...MODE_CHOICES)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove specific users and/or saved emojis.")
        .addStringOption((opt) =>
          opt
            .setName("users")
            .setDescription("Users to remove. Mention users or paste IDs, separated by spaces or commas.")
            .setRequired(false)
            .setMaxLength(1500)
        )
        .addStringOption((opt) =>
          opt
            .setName("emojis")
            .setDescription("Saved emojis to remove.")
            .setRequired(false)
            .setMaxLength(1500)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("mode")
        .setDescription("Change reaction mode without changing users or saved emojis.")
        .addStringOption((opt) =>
          opt
            .setName("mode")
            .setDescription("How the bot chooses reactions.")
            .setRequired(true)
            .addChoices(...MODE_CHOICES)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Clear users, saved emojis, or everything.")
        .addStringOption((opt) =>
          opt
            .setName("target")
            .setDescription("What to clear.")
            .setRequired(true)
            .addChoices(
              { name: "users", value: "users" },
              { name: "saved emojis", value: "emojis" },
              { name: "everything", value: "all" }
            )
        )
    )
    .addSubcommand((sub) =>
      sub.setName("off").setDescription("Disable automatic reactions and remove this server's settings.")
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Show the current automatic reaction settings.")
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
  console.log(`Loaded ${STANDARD_EMOJIS.length} standard emojis.`);

  for (const guild of client.guilds.cache.values()) {
    await registerCommandsForGuild(guild);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  await registerCommandsForGuild(guild);
});

function ownerOnly(interaction) {
  if (interaction.user.id === interaction.guild.ownerId) return true;

  interaction.reply({
    content: "Only the server owner can configure this bot.",
    flags: MessageFlags.Ephemeral,
  });

  return false;
}

function saveGuildSetting(guildId, setting) {
  settings[guildId] = setting;
  saveSettings(settings);
}

function getGuildSettingOrEmpty(guildId) {
  return normalizeSetting(settings[guildId]) || emptySetting();
}

function formatMode(mode) {
  const found = MODE_CHOICES.find((choice) => choice.value === mode);
  return found ? found.name.split(" - ")[0] : mode;
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "autoreact") return;

  if (!interaction.guild) {
    return interaction.reply({
      content: "This command only works in a server.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!ownerOnly(interaction)) return;

  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (subcommand === "set") {
    const usersInput = interaction.options.getString("users") || "";
    const emojisInput = interaction.options.getString("emojis") || "";
    const requestedMode = interaction.options.getString("mode");

    if (!usersInput && !emojisInput && !requestedMode) {
      return interaction.reply({
        content: "Nothing was changed. Provide users, emojis, mode, or some combination of them.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const current = getGuildSettingOrEmpty(guildId);
    const warnings = [];

    const userIdsToAdd = parseUserIds(usersInput);
    if (usersInput && userIdsToAdd.length === 0) {
      warnings.push("No valid users were found in the users field.");
    }

    const parsedEmojis = await parseEmojiList(emojisInput, interaction.guild);
    if (emojisInput && parsedEmojis.emojis.length === 0) {
      warnings.push("No usable emojis were found in the emojis field.");
    }
    warnings.push(...parsedEmojis.warnings);

    for (const userId of userIdsToAdd) uniquePush(current.userIds, userId);
    for (const emoji of parsedEmojis.emojis) uniquePush(current.emojis, emoji);

    current.userIds = current.userIds.slice(0, MAX_USERS);
    current.emojis = current.emojis.slice(0, MAX_CONFIGURED_EMOJIS);
    if (requestedMode) current.mode = normalizeMode(requestedMode);
    current.version = SETTINGS_VERSION;
    current.updatedAt = new Date().toISOString();

    saveGuildSetting(guildId, current);

    if (userIdsToAdd.length >= MAX_USERS) warnings.push(`Only the first ${MAX_USERS} users from this command were processed.`);
    if (parsedEmojis.truncated) warnings.push(`Only the first ${MAX_CONFIGURED_EMOJIS} emojis from this command were processed.`);
    if (current.mode === "all_configured" && current.emojis.length > MAX_REACTIONS_PER_MESSAGE) {
      warnings.push(`all-configured mode reacts with the first ${MAX_REACTIONS_PER_MESSAGE} saved emojis per message.`);
    }
    if ((current.mode === "random_configured" || current.mode === "all_configured") && current.emojis.length === 0) {
      warnings.push("This mode needs saved emojis. Add emojis or switch to random-standard/random-server.");
    }

    return interaction.reply({
      content: [
        "Settings updated. Existing users/emojis were kept.",
        `Users watched: ${current.userIds.length} (${summarizeList(current.userIds, (id) => `<@${id}>`)}).`,
        `Saved emojis: ${current.emojis.length} (${summarizeList(current.emojis)}).`,
        `Mode: ${formatMode(current.mode)}.`,
        warnings.length ? `Warnings: ${warnings.join(" ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "remove") {
    const usersInput = interaction.options.getString("users") || "";
    const emojisInput = interaction.options.getString("emojis") || "";

    if (!usersInput && !emojisInput) {
      return interaction.reply({
        content: "Nothing was removed. Provide users, emojis, or both.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const current = getGuildSettingOrEmpty(guildId);
    const userIdsToRemove = parseUserIds(usersInput);
    const parsedEmojis = await parseEmojiList(emojisInput, interaction.guild);

    const oldUserCount = current.userIds.length;
    const oldEmojiCount = current.emojis.length;

    current.userIds = removeItems(current.userIds, userIdsToRemove);
    current.emojis = removeItems(current.emojis, parsedEmojis.emojis);
    current.version = SETTINGS_VERSION;
    current.updatedAt = new Date().toISOString();

    saveGuildSetting(guildId, current);

    const removedUsers = oldUserCount - current.userIds.length;
    const removedEmojis = oldEmojiCount - current.emojis.length;
    const warnings = [...parsedEmojis.warnings];

    return interaction.reply({
      content: [
        `Removed ${removedUsers} user(s) and ${removedEmojis} saved emoji reaction(s).`,
        `Users watched now: ${current.userIds.length} (${summarizeList(current.userIds, (id) => `<@${id}>`)}).`,
        `Saved emojis now: ${current.emojis.length} (${summarizeList(current.emojis)}).`,
        `Mode: ${formatMode(current.mode)}.`,
        warnings.length ? `Warnings: ${warnings.join(" ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "mode") {
    const requestedMode = interaction.options.getString("mode", true);
    const current = getGuildSettingOrEmpty(guildId);
    current.mode = normalizeMode(requestedMode);
    current.version = SETTINGS_VERSION;
    current.updatedAt = new Date().toISOString();
    saveGuildSetting(guildId, current);

    const warnings = [];
    if ((current.mode === "random_configured" || current.mode === "all_configured") && current.emojis.length === 0) {
      warnings.push("This mode needs saved emojis. Add emojis or switch to random-standard/random-server.");
    }
    if (current.mode === "all_configured" && current.emojis.length > MAX_REACTIONS_PER_MESSAGE) {
      warnings.push(`all-configured mode reacts with the first ${MAX_REACTIONS_PER_MESSAGE} saved emojis per message.`);
    }

    return interaction.reply({
      content: [
        `Mode changed to ${formatMode(current.mode)}. Users and saved emojis were not changed.`,
        warnings.length ? `Warnings: ${warnings.join(" ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "clear") {
    const target = interaction.options.getString("target", true);
    const current = getGuildSettingOrEmpty(guildId);

    if (target === "users") {
      current.userIds = [];
    } else if (target === "emojis") {
      current.emojis = [];
    } else {
      delete settings[guildId];
      saveSettings(settings);
      return interaction.reply({
        content: "Cleared all automatic reaction settings for this server.",
        flags: MessageFlags.Ephemeral,
      });
    }

    current.version = SETTINGS_VERSION;
    current.updatedAt = new Date().toISOString();
    saveGuildSetting(guildId, current);

    return interaction.reply({
      content: `Cleared ${target}. Other settings were kept.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (subcommand === "off") {
    delete settings[guildId];
    saveSettings(settings);

    return interaction.reply({
      content: "Disabled automatic reactions and removed this server's settings.",
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

    const serverEmojiCount = (await getGuildReactionEmojis(interaction.guild)).length;

    return interaction.reply({
      content: [
        `Users watched: ${current.userIds.length} (${summarizeList(current.userIds, (id) => `<@${id}>`)}).`,
        `Saved emojis: ${current.emojis.length} (${summarizeList(current.emojis)}).`,
        `Mode: ${formatMode(current.mode)}.`,
        `Standard emoji pool loaded: ${STANDARD_EMOJIS.length}.`,
        `Server emoji pool available: ${serverEmojiCount}.`,
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

  if (current.mode === "all_configured" || current.mode === "random_configured") {
    if (current.emojis.length === 0) return;
  }

  await reactToMessage(message, current);
});

client.login(TOKEN);
