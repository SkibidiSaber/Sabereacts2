# Discord Owner Auto-React Bot

A small Discord bot that lets the server owner choose multiple users and multiple reactions. It can either add every configured emoji to each matching message, or pick one random emoji each time.

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

### React with every selected emoji

```txt
/autoreact set users:@UserOne @UserTwo emojis:👍, 😂, :party: mode:all
```

### Pick one random emoji per matching message

```txt
/autoreact set users:@UserOne @UserTwo emojis:👍, 😂, :party: mode:random
```

### Status and disable

```txt
/autoreact status
/autoreact off
```

## Users field

The `users` field accepts multiple Discord mentions or raw user IDs.

Examples:

```txt
@UserOne @UserTwo
123456789012345678, 987654321098765432
```

Discord slash command user picker fields select one user at a time, so this bot uses a text field and parses multiple mentions/IDs.

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

## Bot permissions

The bot needs:

- View Channels
- Read Message History
- Add Reactions

The OAuth2 scopes should include:

- bot
- applications.commands

## Notes

- `mode:all` adds every configured emoji to each matching message.
- `mode:random` picks one configured emoji for each matching message.
- The bot stores up to 50 users and 20 emojis per server.
- The bot ignores messages from bots.
- Message Content Intent is not required because the bot checks the message author, not the message text.
