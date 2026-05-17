# Discord Auto-React Bot v5

Browser-hosted Discord bot for Railway/GitHub. No Python required.

## New in v5

- Adds `all-selected` mode.
- Separates **selected emojis** from **saved emojis**.
- Adds `/autoreact save emoji:<emoji>` as a dedicated command.
- Adds `/autoreact react` to add reactions to a specific existing message.
- Keeps the v4 permission model: server owner, Administrators, and whitelisted members can use bot commands.

## Concepts

### Target users

The users whose new messages should receive reactions.

### Selected emojis

Emojis added through the `emojis` option on `/autoreact set`.

These are used by:

- `all-selected`
- `random-selected`

### Saved emojis

Reusable emojis added through the dedicated save command:

```txt
/autoreact save emoji:👍, 😂, :serverEmoji:
```

These are used by:

- `all-saved`
- `random-saved`

### Standard emojis

The bot loads standard Unicode/Discord emoji from `emoji-datasource`.

These are used by:

- `random-standard`
- `random-any`

### Server emojis

The bot fetches the custom emoji pool from the current server.

These are used by:

- `random-server`
- `random-any`

## Common commands

Add users and selected emojis:

```txt
/autoreact set users:@UserOne @UserTwo emojis:👍, 😂, :serverEmoji: mode:all-selected
```

Add another target user later without deleting existing users:

```txt
/autoreact set users:@UserThree
```

Add more selected emojis later without deleting existing selected emojis:

```txt
/autoreact set emojis:🔥, 💀
```

Save reusable emojis:

```txt
/autoreact save emoji:👍, 😂, :serverEmoji:
```

Use all saved emojis on matching user messages:

```txt
/autoreact set mode:all-saved
```

Use one random standard emoji:

```txt
/autoreact set users:@UserOne mode:random-standard
```

Use one random server emoji:

```txt
/autoreact set users:@UserOne mode:random-server
```

Add reactions to a specific message using typed emoji(s):

```txt
/autoreact react message:<message-id-or-link> source:Typed emoji(s) emoji:👍, 😂
```

Add selected reactions to a specific message:

```txt
/autoreact react message:<message-id-or-link> source:All selected emojis
```

Check status:

```txt
/autoreact status
```

Disable without clearing configuration:

```txt
/autoreact off
```

Enable again:

```txt
/autoreact on
```

## Removing things

Remove target users or selected emojis:

```txt
/autoreact remove users:@UserOne emojis:👍, 😂
```

Remove saved emojis:

```txt
/autoreact unsave emoji:👍, 😂
```

Clear a list:

```txt
/autoreact clear target:Selected emojis
```

## Whitelist commands

Only the server owner or members with Administrator can manage the whitelist.

```txt
/autoreact whitelist-add users:@TrustedUser
/autoreact whitelist-remove users:@TrustedUser
/autoreact whitelist-status
/autoreact whitelist-clear
```

## Required bot permissions

- View Channels
- Read Message History
- Add Reactions

The bot does not need Message Content Intent because it does not read message text.

## Railway variables

Set this Railway variable:

```txt
DISCORD_TOKEN=your_bot_token_here
```

Recommended persistent volume mount:

```txt
/data
```

Settings are stored at:

```txt
/data/settings.json
```
