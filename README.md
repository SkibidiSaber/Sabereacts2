# Discord AutoReact + AutoResponse Bot v6

This version keeps the v5 reaction features and adds phrase-based bot messages.

## Required Discord Developer Portal changes

Because v6 reads message text, enable **Message Content Intent**:

1. Open Discord Developer Portal.
2. Select your application.
3. Go to **Bot**.
4. Under **Privileged Gateway Intents**, enable **Message Content Intent**.
5. Save changes.
6. Redeploy/restart the Railway service.

If the bot is verified or in many servers, Discord may require approval for privileged intent usage.

## Required bot permissions

Re-invite the bot, or update its role in the server, so it has:

- View Channels
- Send Messages
- Read Message History
- Add Reactions
- Use External Emojis, optional, if you want cross-server emoji reactions where allowed

For the invite URL generator, use scopes:

- bot
- applications.commands

## Railway/GitHub update

Replace the existing GitHub files with these v6 files:

- index.js
- package.json
- README.md

Commit/upload them. Railway should redeploy automatically.

Make sure Railway still has this variable:

```txt
DISCORD_TOKEN=your_bot_token_here
```

For persistent settings, keep a Railway volume mounted at:

```txt
/data
```

## Reaction commands

Set targets, selected emojis, and mode additively:

```txt
/autoreact set users:@UserOne @UserTwo emojis:👍 😂 mode:all-selected
```

Save emojis for saved-emoji modes:

```txt
/autoreact save emoji:🔥 💀 <:party:123456789012345678>
```

Remove saved emojis:

```txt
/autoreact unsave emoji:🔥
```

Use random standard Unicode emoji:

```txt
/autoreact set users:@UserOne mode:random-standard
```

Use random server-native custom emoji:

```txt
/autoreact set users:@UserOne mode:random-server
```

React to a specific message:

```txt
/autoreact react message:MESSAGE_ID_OR_LINK source:typed emoji:👍 😂
```

```txt
/autoreact react message:MESSAGE_ID_OR_LINK source:all-saved
```

## Auto-response commands

Add a phrase and response:

```txt
/autoresponse add phrase:hello response:Hello back.
```

Add multiple possible responses by repeating the same phrase:

```txt
/autoresponse add phrase:hello response:Hi.
/autoresponse add phrase:hello response:Hey there.
/autoresponse add phrase:hello response:Hello back.
```

When a message matches `hello`, the bot picks one response at random.

Match types:

```txt
/autoresponse add phrase:hello response:Hi. match:contains
/autoresponse add phrase:hello response:Hi. match:whole-word
/autoresponse add phrase:hello response:Hi. match:exact-message
```

List configured phrases:

```txt
/autoresponse list
```

Remove a phrase entirely:

```txt
/autoresponse remove phrase:hello
```

Remove only one response from a phrase:

```txt
/autoresponse remove phrase:hello response:Hi.
```

Disable or enable autoresponses:

```txt
/autoresponse off
/autoresponse on
```

## Access control

These members can configure the bot:

- Server owner
- Members with Administrator
- Whitelisted members

Whitelist commands:

```txt
/autoreact whitelist-add users:@TrustedUser
/autoreact whitelist-remove users:@TrustedUser
/autoreact whitelist-status
/autoreact whitelist-clear
```

Only the server owner or Administrators can manage the whitelist.

## Response placeholders

Auto-response messages can include:

- `{user}`
- `{username}`
- `{server}`

Example:

```txt
/autoresponse add phrase:welcome response:Welcome, {username}.
```

The bot disables automatic mention parsing for its generated messages to reduce accidental mass pings.
