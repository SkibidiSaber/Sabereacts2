# Discord Owner Auto-React Bot v3

A small Discord bot that lets the server owner choose users and automatic reactions. Settings are additive: new commands keep previous users and saved emojis unless you explicitly remove or clear them.

## Files

- `index.js` - the bot
- `package.json` - Node.js dependency/start configuration

## Required environment variable

Set this in Railway:

```txt
DISCORD_TOKEN=your_bot_token_here
```

Do not put the token in GitHub.

## Railway persistence

Create a Railway Volume mounted at:

```txt
/data
```

The bot stores settings at `/data/settings.json`. Without a volume, settings may reset after redeploys.

## Discord use

Only the Discord server owner can configure the bot.

### Add watched users and saved emojis

This keeps previous users and previous saved emojis:

```txt
/autoreact set users:@UserOne @UserTwo emojis:👍, 😂, :party: mode:all-configured
```

Run it again to add more users or emojis:

```txt
/autoreact set users:@UserThree emojis:🔥, 💀
```

### Random from saved emojis

```txt
/autoreact mode mode:random-configured
```

or set it while adding settings:

```txt
/autoreact set users:@UserOne emojis:👍, 😂, 🔥 mode:random-configured
```

### Random from all standard Discord/Unicode emojis

No `emojis` field is required for this mode:

```txt
/autoreact set users:@UserOne @UserTwo mode:random-standard
```

The bot loads the standard emoji list from `emoji-datasource`. A small built-in fallback list is used only if that package cannot load.

### Random from this server's custom emojis

No `emojis` field is required for this mode:

```txt
/autoreact set users:@UserOne mode:random-server
```

The bot chooses one random emoji from the server's custom emoji list. If the server has no custom emojis, it will not react in this mode.

### Random from saved + standard + server emojis

```txt
/autoreact set users:@UserOne emojis:👍, 😂 mode:random-any
```

### Remove specific users or saved emojis

```txt
/autoreact remove users:@UserOne
```

```txt
/autoreact remove emojis:👍, :party:
```

### Clear users, saved emojis, or everything

```txt
/autoreact clear target:users
/autoreact clear target:saved emojis
/autoreact clear target:everything
```

### Disable all settings

```txt
/autoreact off
```

### Check current settings

```txt
/autoreact status
```

## Users field

The `users` field accepts multiple Discord mentions or raw user IDs.

Examples:

```txt
@UserOne @UserTwo
123456789012345678, 987654321098765432
```

## Emojis field

The `emojis` field accepts comma-separated reactions.

Supported examples:

```txt
👍, 😂, 🫡
<:custom_name:123456789012345678>
<a:animated_name:123456789012345678>
:serverEmojiName:
```

For server emojis, either paste the emoji directly into the command or use `:serverEmojiName:`. The bot resolves `:serverEmojiName:` against emojis in that server.

## Modes

- `all-configured` - react with every saved emoji. The bot caps this at 20 reactions per message to avoid accidental mass reaction spam and Discord reaction limits.
- `random-configured` - pick one random saved emoji per message.
- `random-standard` - pick one random standard Discord/Unicode emoji per message.
- `random-server` - pick one random custom emoji native to that server per message.
- `random-any` - pick one random emoji from saved emojis, standard emojis, and server custom emojis.

## Bot permissions

The bot needs:

- View Channels
- Read Message History
- Add Reactions

The OAuth2 scopes should include:

- bot
- applications.commands

## Notes

- Commands are additive by default. `/autoreact set` does not wipe old users or old saved emojis.
- Use `/autoreact remove`, `/autoreact clear`, or `/autoreact off` when you want to remove settings.
- The bot stores up to 100 watched users and 100 saved emojis per server.
- The bot ignores messages from bots.
- Message Content Intent is not required because the bot checks the message author, not message text.
