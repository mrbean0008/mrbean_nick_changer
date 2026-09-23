// ============================================================
// PUBLIC MULTI-SERVER DISCORD NICKNAME MANAGEMENT BOT
// discord.js v14
// Railway Ready
//
// FEATURES
// - Multi-server support
// - Per-server configuration
// - Nickname request channel
// - Moderator approval/rejection
// - Reject reason modal
// - Automatic starting-variable protection
// - Bot-approved starting variables are allowed
// - Manual starting variables are automatically removed
// - RESET / reset / Reset support
// - Reset uses cleaned Discord username
// - Nickname history
// - Moderator logs
// - User DM notifications
// - Railway health endpoint
// ============================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActivityType,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ============================================================
// ENV
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error(
    "❌ DISCORD_TOKEN is missing. Add DISCORD_TOKEN in Railway Variables."
  );

  process.exit(1);
}

// ============================================================
// DATA DIRECTORY
// ============================================================

const DATA_DIR = path.join(
  __dirname,
  "data"
);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

const CONFIG_FILE = path.join(
  DATA_DIR,
  "guildConfigs.json"
);

const HISTORY_FILE = path.join(
  DATA_DIR,
  "nickHistory.json"
);

// ============================================================
// JSON HELPERS
// ============================================================

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        JSON.stringify(
          fallback,
          null,
          2
        )
      );

      return fallback;
    }

    const data = fs.readFileSync(
      file,
      "utf8"
    );

    if (!data.trim()) {
      return fallback;
    }

    return JSON.parse(data);

  } catch (error) {
    console.error(
      `❌ Failed to load ${file}:`,
      error
    );

    return fallback;
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(
        data,
        null,
        2
      )
    );

    return true;

  } catch (error) {
    console.error(
      `❌ Failed to save ${file}:`,
      error
    );

    return false;
  }
}

// ============================================================
// DATA
// ============================================================

let guildConfigs =
  loadJSON(
    CONFIG_FILE,
    {}
  );

let nickHistory =
  loadJSON(
    HISTORY_FILE,
    {}
  );

// ============================================================
// SAVE FUNCTIONS
// ============================================================

function saveConfigs() {
  saveJSON(
    CONFIG_FILE,
    guildConfigs
  );
}

function saveHistory() {
  saveJSON(
    HISTORY_FILE,
    nickHistory
  );
}

// ============================================================
// SERVER CONFIG
// ============================================================

function createDefaultConfig() {
  return {
    requestChannelId: null,

    logChannelId: null,

    // Roles allowed to approve/reject
    approverRoleIds: []
  };
}

function getGuildConfig(guildId) {
  if (!guildConfigs[guildId]) {
    guildConfigs[guildId] =
      createDefaultConfig();

    saveConfigs();
  }

  // Make sure old configs still work
  const defaults =
    createDefaultConfig();

  guildConfigs[guildId] = {
    ...defaults,
    ...guildConfigs[guildId]
  };

  return guildConfigs[guildId];
}

// ============================================================
// HELPERS
// ============================================================

function isAdmin(member) {
  if (!member) {
    return false;
  }

  return member.permissions.has(
    PermissionsBitField.Flags.Administrator
  );
}

// ============================================================
// ROLE CHECK
// ============================================================

function hasAnyRole(
  member,
  roleIds = []
) {
  if (!member) {
    return false;
  }

  return roleIds.some(
    roleId =>
      member.roles.cache.has(
        roleId
      )
  );
}

// ============================================================
// APPROVER
// ============================================================

function canApprove(
  member,
  config
) {
  return (
    isAdmin(member) ||
    hasAnyRole(
      member,
      config.approverRoleIds
    )
  );
}

// ============================================================
// STARTING VARIABLE REMOVER
// ============================================================
//
// IMPORTANT:
//
// ONLY STARTING special characters / emoji / symbols
// are removed.
//
// Examples:
//
// 🔥Homo       -> Homo
// ★ Shakin     -> Shakin
// 『Homo       -> Homo
// !Homo        -> Homo
// ~Homo        -> Homo
//
// Middle/end:
//
// Homo★        -> Homo★
// Ho★mo        -> Ho★mo
// Homo!        -> Homo!
//
// ============================================================

function removeStartingVariables(
  nickname
) {
  if (!nickname) {
    return nickname;
  }

  let result =
    nickname.trim();

  result =
    result.replace(
      /^[^\p{L}\p{N}\s]+/gu,
      ""
    );

  return result.trim();
}

// ============================================================
// CLEAN DEFAULT USERNAME
// ============================================================
//
// Discord username = default/main account name.
//
// Example:
//
// 🔥Homo
// ↓
// Homo
//
// This is used when RESET is requested.
//
// ============================================================

function getCleanDefaultNickname(
  member
) {
  if (!member || !member.user) {
    return null;
  }

  const username =
    member.user.username ||
    "";

  const cleaned =
    removeStartingVariables(
      username
    );

  return cleaned || username;
}

// ============================================================
// NORMALIZE REQUESTED NICKNAME
// ============================================================
//
// Starting variables are NOT allowed in normal manual requests.
//
// BUT:
//
// If a moderator approves the request,
// the exact final nickname is applied by the bot.
//
// That bot-set nickname is temporarily marked as
// an authorized bot change so guildMemberUpdate
// does not remove the variable again.
//
// ============================================================

function normalizeNickname(
  nickname
) {
  return removeStartingVariables(
    nickname
  );
}

// ============================================================
// VALIDATE NICKNAME
// ============================================================

function validateNickname(
  nickname
) {
  if (!nickname) {
    return (
      "❌ Nickname cannot be empty."
    );
  }

  if (nickname.length > 32) {
    return (
      "❌ Nickname cannot be longer than **32 characters**."
    );
  }

  return null;
}

// ============================================================
// HISTORY KEY
// ============================================================

function historyKey(
  guildId,
  userId
) {
  return `${guildId}:${userId}`;
}

// ============================================================
// PENDING REQUESTS
// ============================================================

const pendingRequests =
  new Map();

// ============================================================
// BOT AUTHORIZED NICKNAME CHANGES
// ============================================================
//
// guildMemberUpdate cannot automatically know whether
// a nickname was changed manually or by this bot.
//
// So before bot changes a nickname:
//
// guildId:userId -> expectedNickname
//
// Then guildMemberUpdate sees the change and allows it.
//
// ============================================================

const authorizedBotChanges =
  new Map();

function botChangeKey(
  guildId,
  userId
) {
  return `${guildId}:${userId}`;
}

function markBotNicknameChange(
  guildId,
  userId,
  nickname
) {
  authorizedBotChanges.set(
    botChangeKey(
      guildId,
      userId
    ),
    nickname
  );
}

function consumeBotNicknameChange(
  guildId,
  userId,
  nickname
) {
  const key =
    botChangeKey(
      guildId,
      userId
    );

  const expected =
    authorizedBotChanges.get(
      key
    );

  if (
    expected === undefined
  ) {
    return false;
  }

  if (
    expected === nickname
  ) {
    authorizedBotChanges.delete(
      key
    );

    return true;
  }

  // If something else changed the nickname,
  // do not trust the old bot marker.
  authorizedBotChanges.delete(
    key
  );

  return false;
}

// ============================================================
// REQUEST ID
// ============================================================

function createRequestId() {
  let id;

  do {
    id =
      "REQ-" +
      Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();

  } while (
    pendingRequests.has(id)
  );

  return id;
}

// ============================================================
// FOOTER
// ============================================================

function footer() {
  return {
    text:
      "Nickname Management System"
  };
}

// ============================================================
// SEND LOG
// ============================================================

async function sendLog(
  guild,
  config,
  embed
) {
  try {
    if (!config.logChannelId) {
      return;
    }

    const channel =
      guild.channels.cache.get(
        config.logChannelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      return;
    }

    await channel.send({
      embeds: [embed]
    });

  } catch (error) {
    console.error(
      "❌ Failed to send log:",
      error.message ||
      error
    );
  }
}

// ============================================================
// AUTO REMOVE LOG
// ============================================================

async function sendAutoRemoveLog(
  guild,
  config,
  member,
  oldNickname,
  cleanNickname
) {
  try {
    if (!config.logChannelId) {
      return;
    }

    const channel =
      guild.channels.cache.get(
        config.logChannelId
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      return;
    }

    const embed =
      new EmbedBuilder()
        .setColor(
          0xffb84d
        )
        .setTitle(
          "🧹 Unauthorized Variable Removed"
        )
        .setThumbnail(
          member.displayAvatarURL({
            extension:
              "png",
            size:
              256
          })
        )
        .addFields(
          {
            name:
              "👤 Member",
            value:
              `${member}`,
            inline:
              true
          },
          {
            name:
              "🧾 Old Nickname",
            value:
              oldNickname ||
              member.user.username,
            inline:
              false
          },
          {
            name:
              "🆕 New Nickname",
            value:
              cleanNickname,
            inline:
              false
          },
          {
            name:
              "📌 Action",
            value:
              "Starting variable was automatically removed because it was not set through the bot.",
            inline:
              false
          }
        )
        .setFooter(
          footer()
        )
        .setTimestamp();

    await channel.send({
      embeds: [embed]
    });

  } catch (error) {
    console.error(
      "❌ Failed to send auto-remove log:",
      error.message ||
      error
    );
  }
}

// ============================================================
// SAVE NICKNAME HISTORY
// ============================================================

function saveOldNickname(
  guild,
  member
) {
  const key =
    historyKey(
      guild.id,
      member.id
    );

  nickHistory[key] = {
    guildId:
      guild.id,

    userId:
      member.id,

    nickname:
      member.nickname ||
      member.user.username,

    savedAt:
      Date.now()
  };

  saveHistory();
}

// ============================================================
// CHECK BOT NICKNAME PERMISSION
// ============================================================

function botCanManageNickname(
  guild
) {
  const botMember =
    guild.members.me;

  if (!botMember) {
    return false;
  }

  return botMember.permissions.has(
    PermissionsBitField.Flags.ManageNicknames
  );
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [

  // ==========================================================
  // /nicksetup
  // ==========================================================

  new SlashCommandBuilder()
    .setName(
      "nicksetup"
    )
    .setDescription(
      "Configure nickname system for this server."
    )
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.Administrator.toString()
    )

    // Request channel
    .addSubcommand(sub =>
      sub
        .setName(
          "request-channel"
        )
        .setDescription(
          "Set nickname request channel."
        )
        .addChannelOption(option =>
          option
            .setName(
              "channel"
            )
            .setDescription(
              "Nickname request channel."
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )

    // Log channel
    .addSubcommand(sub =>
      sub
        .setName(
          "log-channel"
        )
        .setDescription(
          "Set nickname moderator/log channel."
        )
        .addChannelOption(option =>
          option
            .setName(
              "channel"
            )
            .setDescription(
              "Nickname log channel."
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )

    // Approver add
    .addSubcommand(sub =>
      sub
        .setName(
          "approver-add"
        )
        .setDescription(
          "Allow a role to approve/reject requests."
        )
        .addRoleOption(option =>
          option
            .setName(
              "role"
            )
            .setDescription(
              "Approver role."
            )
            .setRequired(true)
        )
    )

    // Approver remove
    .addSubcommand(sub =>
      sub
        .setName(
          "approver-remove"
        )
        .setDescription(
          "Remove a role from approvers."
        )
        .addRoleOption(option =>
          option
            .setName(
              "role"
            )
            .setDescription(
              "Role to remove."
            )
            .setRequired(true)
        )
    )

    // Show config
    .addSubcommand(sub =>
      sub
        .setName(
          "show"
        )
        .setDescription(
          "Show current nickname configuration."
        )
    ),

  // ==========================================================
  // /nickpanel
  // ==========================================================

  new SlashCommandBuilder()
    .setName(
      "nickpanel"
    )
    .setDescription(
      "Send nickname request panel."
    )
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.Administrator.toString()
    )
    .addChannelOption(option =>
      option
        .setName(
          "channel"
        )
        .setDescription(
          "Channel where panel should be sent."
        )
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(false)
    )

].map(
  command =>
    command.toJSON()
);

// ============================================================
// DISCORD REST
// ============================================================

const rest =
  new REST({
    version: "10"
  }).setToken(
    TOKEN
  );

// ============================================================
// REGISTER COMMANDS PER SERVER
// ============================================================

async function registerGuildCommands(
  guild
) {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        guild.id
      ),
      {
        body:
          commands
      }
    );

    console.log(
      `✅ Slash commands registered: ${guild.name} (${guild.id})`
    );

  } catch (error) {
    console.error(
      `❌ Slash command registration failed in ${guild.name} (${guild.id}):`,
      error.message ||
      error
    );
  }
}

// ============================================================
// SCAN SERVER MEMBERS
// ============================================================
//
// Existing members are checked when:
// - Bot starts
// - Bot joins server
//
// Any unauthorized starting variable is removed.
//
// ============================================================

async function scanGuildMembers(
  guild
) {
  try {
    const config =
      getGuildConfig(
        guild.id
      );

    console.log(
      `🔎 Scanning members in ${guild.name}...`
    );

    const botMember =
      guild.members.me;

    if (!botMember) {
      console.log(
        `⚠️ Bot member unavailable in ${guild.name}`
      );

      return;
    }

    if (
      !botMember.permissions.has(
        PermissionsBitField.Flags.ManageNicknames
      )
    ) {
      console.log(
        `⚠️ Missing Manage Nicknames permission in ${guild.name}`
      );

      return;
    }

    const members =
      await guild.members.fetch();

    let changed = 0;

    for (
      const member of members.values()
    ) {
      try {

        // Ignore bots
        if (
          member.user.bot
        ) {
          continue;
        }

        // No nickname
        if (
          !member.nickname
        ) {
          continue;
        }

        const cleanNickname =
          removeStartingVariables(
            member.nickname
          );

        // Nothing to clean
        if (
          cleanNickname ===
          member.nickname
        ) {
          continue;
        }

        // Cannot change server owner
        if (
          member.id ===
          guild.ownerId
        ) {
          continue;
        }

        // Role hierarchy
        if (
          member.roles.highest.position >=
          botMember.roles.highest.position
        ) {
          console.log(
            `⚠️ Cannot change ${member.user.tag} in ${guild.name} - role hierarchy`
          );

          continue;
        }

        const oldNickname =
          member.nickname;

        markBotNicknameChange(
          guild.id,
          member.id,
          cleanNickname
        );

        await member.setNickname(
          cleanNickname,
          "Initial nickname protection scan"
        );

        changed++;

        console.log(
          `🧹 ${guild.name} | ${member.user.tag}: ${oldNickname} -> ${cleanNickname}`
        );

        await sendAutoRemoveLog(
          guild,
          config,
          member,
          oldNickname,
          cleanNickname
        );

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              300
            )
        );

      } catch (error) {
        console.error(
          `❌ Could not change ${member.user.tag}:`,
          error.message ||
          error
        );
      }
    }

    console.log(
      `✅ Scan complete: ${guild.name} | Changed: ${changed}`
    );

  } catch (error) {
    console.error(
      `❌ Member scan failed for ${guild.name}:`,
      error.message ||
      error
    );
  }
}

// ============================================================
// READY
// ============================================================

client.once(
  "clientReady",
  async readyClient => {

    console.log(
      "========================================"
    );

    console.log(
      `✅ Logged in as ${readyClient.user.tag}`
    );

    console.log(
      `🌐 Servers: ${client.guilds.cache.size}`
    );

    console.log(
      "========================================"
    );

    client.user.setPresence({
      activities: [
        {
          name:
            "Nickname Management",
          type:
            ActivityType.Watching
        }
      ],
      status:
        "online"
    });

    // Register commands
    for (
      const guild of client.guilds.cache.values()
    ) {
      await registerGuildCommands(
        guild
      );
    }

    // Scan existing members
    for (
      const guild of client.guilds.cache.values()
    ) {
      await scanGuildMembers(
        guild
      );
    }
  }
);

// ============================================================
// INTERACTION CREATE
// ============================================================

client.on(
  "interactionCreate",
  async interaction => {

    try {

      // ========================================================
      // SLASH COMMANDS
      // ========================================================

      if (
        interaction.isChatInputCommand()
      ) {

        if (
          !interaction.guild
        ) {
          return interaction.reply({
            content:
              "❌ This command can only be used inside a server.",
            ephemeral:
              true
          });
        }

        const guild =
          interaction.guild;

        const member =
          await guild.members.fetch(
            interaction.user.id
          ).catch(
            () => null
          );

        if (!member) {
          return interaction.reply({
            content:
              "❌ Could not find your server membership.",
            ephemeral:
              true
          });
        }

        if (
          !isAdmin(member)
        ) {
          return interaction.reply({
            content:
              "❌ Only server administrators can configure this bot.",
            ephemeral:
              true
          });
        }

        const config =
          getGuildConfig(
            guild.id
          );

        // ======================================================
        // NICKSETUP
        // ======================================================

        if (
          interaction.commandName ===
          "nicksetup"
        ) {

          const sub =
            interaction.options.getSubcommand();

          // ----------------------------------------------------
          // REQUEST CHANNEL
          // ----------------------------------------------------

          if (
            sub ===
            "request-channel"
          ) {

            const channel =
              interaction.options.getChannel(
                "channel"
              );

            config.requestChannelId =
              channel.id;

            saveConfigs();

            return interaction.reply({
              content:
                `✅ Nickname request channel set to ${channel}.`,
              ephemeral:
                true
            });
          }

          // ----------------------------------------------------
          // LOG CHANNEL
          // ----------------------------------------------------

          if (
            sub ===
            "log-channel"
          ) {

            const channel =
              interaction.options.getChannel(
                "channel"
              );

            config.logChannelId =
              channel.id;

            saveConfigs();

            return interaction.reply({
              content:
                `✅ Nickname log channel set to ${channel}.`,
              ephemeral:
                true
            });
          }

          // ----------------------------------------------------
          // APPROVER ADD
          // ----------------------------------------------------

          if (
            sub ===
            "approver-add"
          ) {

            const role =
              interaction.options.getRole(
                "role"
              );

            if (
              !config.approverRoleIds.includes(
                role.id
              )
            ) {
              config.approverRoleIds.push(
                role.id
              );
            }

            saveConfigs();

            return interaction.reply({
              content:
                `✅ ${role} can now approve/reject nickname requests.`,
              ephemeral:
                true
            });
          }

          // ----------------------------------------------------
          // APPROVER REMOVE
          // ----------------------------------------------------

          if (
            sub ===
            "approver-remove"
          ) {

            const role =
              interaction.options.getRole(
                "role"
              );

            config.approverRoleIds =
              config.approverRoleIds.filter(
                id =>
                  id !== role.id
              );

            saveConfigs();

            return interaction.reply({
              content:
                `✅ ${role} was removed from nickname approvers.`,
              ephemeral:
                true
            });
          }

          // ----------------------------------------------------
          // SHOW
          // ----------------------------------------------------

          if (
            sub ===
            "show"
          ) {

            const approvers =
              config.approverRoleIds.length
                ? config.approverRoleIds
                    .map(
                      id =>
                        `<@&${id}>`
                    )
                    .join(
                      ", "
                    )
                : "Not configured";

            const embed =
              new EmbedBuilder()
                .setColor(
                  0x2bafff
                )
                .setTitle(
                  "⚙️ Nickname System Configuration"
                )
                .setDescription(
                  "All nickname variables are controlled by the bot. Members cannot manually keep starting variables."
                )
                .addFields(
                  {
                    name:
                      "📝 Request Channel",
                    value:
                      config.requestChannelId
                        ? `<#${config.requestChannelId}>`
                        : "Not configured"
                  },
                  {
                    name:
                      "📋 Log Channel",
                    value:
                      config.logChannelId
                        ? `<#${config.logChannelId}>`
                        : "Not configured"
                  },
                  {
                    name:
                      "👮 Approver Roles",
                    value:
                      approvers
                  },
                  {
                    name:
                      "✨ Variable System",
                    value:
                      "🟢 Only bot-approved nicknames can keep starting variables."
                  },
                  {
                    name:
                      "🔄 Reset",
                    value:
                      "Typing `reset` returns the member to their cleaned default username."
                  }
                )
                .setFooter(
                  footer()
                )
                .setTimestamp();

            return interaction.reply({
              embeds: [
                embed
              ],
              ephemeral:
                true
            });
          }
        }

        // ======================================================
        // NICKPANEL
        // ======================================================

        if (
          interaction.commandName ===
          "nickpanel"
        ) {

          const selectedChannel =
            interaction.options.getChannel(
              "channel"
            );

          const channel =
            selectedChannel ||
            (
              config.requestChannelId
                ? guild.channels.cache.get(
                    config.requestChannelId
                  )
                : null
            );

          if (!channel) {
            return interaction.reply({
              content:
                "❌ Request channel is not configured.\nUse `/nicksetup request-channel` first.",
              ephemeral:
                true
            });
          }

          const embed =
            new EmbedBuilder()
              .setColor(
                0x2bafff
              )
              .setTitle(
                "📝 Nickname Change"
              )
              .setDescription(
                [
                  "Send your requested nickname in this channel.",
                  "",
                  "**No command or prefix is required.**",
                  "",
                  "**Example:**",
                  "`Shakin Ahmed`",
                  "`🔥 Shakin`",
                  "",
                  "Starting variables can only remain if the nickname is approved through this bot.",
                  "",
                  "If you want to restore your default name, simply type:",
                  "`reset`",
                  "",
                  "The reset command works regardless of capitalization."
                ].join(
                  "\n"
                )
              )
              .setFooter(
                footer()
              )
              .setTimestamp();

          await channel.send({
            embeds: [
              embed
            ]
          });

          return interaction.reply({
            content:
              `✅ Nickname panel sent to ${channel}.`,
            ephemeral:
              true
          });
        }

        return;
      }

      // ========================================================
      // BUTTONS
      // ========================================================

      if (
        interaction.isButton()
      ) {

        const customId =
          interaction.customId;

        // ======================================================
        // REJECT BUTTON
        // ======================================================

        if (
          customId.startsWith(
            "nick_reject_"
          )
        ) {

          const requestId =
            customId.replace(
              "nick_reject_",
              ""
            );

          const request =
            pendingRequests.get(
              requestId
            );

          if (!request) {
            return interaction.reply({
              content:
                "⚠️ This nickname request is no longer active. It may have expired or the bot may have restarted.",
              ephemeral:
                true
            });
          }

          const guild =
            interaction.guild;

          if (!guild) {
            return interaction.reply({
              content:
                "❌ This request is no longer associated with a server.",
              ephemeral:
                true
            });
          }

          if (
            request.guildId !==
            guild.id
          ) {
            return interaction.reply({
              content:
                "❌ This request belongs to another server.",
              ephemeral:
                true
            });
          }

          const config =
            getGuildConfig(
              guild.id
            );

          const moderator =
            await guild.members.fetch(
              interaction.user.id
            ).catch(
              () => null
            );

          if (!moderator) {
            return interaction.reply({
              content:
                "❌ Could not find your server membership.",
              ephemeral:
                true
            });
          }

          if (
            !canApprove(
              moderator,
              config
            )
          ) {
            return interaction.reply({
              content:
                "❌ You do not have permission to reject nickname requests.",
              ephemeral:
                true
            });
          }

          if (
            request.status !==
            "pending"
          ) {
            return interaction.reply({
              content:
                "⚠️ This request has already been processed.",
              ephemeral:
                true
            });
          }

          // ====================================================
          // REJECT REASON MODAL
          // ====================================================

          const modal =
            new ModalBuilder()
              .setCustomId(
                `nick_reject_reason_${requestId}`
              )
              .setTitle(
                "Reject Nickname Request"
              );

          const reasonInput =
            new TextInputBuilder()
              .setCustomId(
                "reject_reason"
              )
              .setLabel(
                "Why are you rejecting this request?"
              )
              .setPlaceholder(
                "Example: Nickname does not follow server rules."
              )
              .setStyle(
                TextInputStyle.Paragraph
              )
              .setMinLength(
                3
              )
              .setMaxLength(
                500
              )
              .setRequired(
                true
              );

          const row =
            new ActionRowBuilder()
              .addComponents(
                reasonInput
              );

          modal.addComponents(
            row
          );

          return interaction.showModal(
            modal
          );
        }

        // ======================================================
        // APPROVE BUTTON
        // ======================================================

        if (
          customId.startsWith(
            "nick_accept_"
          )
        ) {

          const requestId =
            customId.replace(
              "nick_accept_",
              ""
            );

          const request =
            pendingRequests.get(
              requestId
            );

          if (!request) {
            return interaction.reply({
              content:
                "⚠️ This nickname request is no longer active. It may have expired or the bot may have restarted.",
              ephemeral:
                true
            });
          }

          const guild =
            interaction.guild;

          if (!guild) {
            return interaction.reply({
              content:
                "❌ This request is no longer associated with a server.",
              ephemeral:
                true
            });
          }

          if (
            request.guildId !==
            guild.id
          ) {
            return interaction.reply({
              content:
                "❌ This request belongs to another server.",
              ephemeral:
                true
            });
          }

          const config =
            getGuildConfig(
              guild.id
            );

          const moderator =
            await guild.members.fetch(
              interaction.user.id
            ).catch(
              () => null
            );

          if (!moderator) {
            return interaction.reply({
              content:
                "❌ Could not find your server membership.",
              ephemeral:
                true
            });
          }

          if (
            !canApprove(
              moderator,
              config
            )
          ) {
            return interaction.reply({
              content:
                "❌ You do not have permission to approve or reject nickname requests.",
              ephemeral:
                true
            });
          }

          if (
            request.status !==
            "pending"
          ) {
            return interaction.reply({
              content:
                "⚠️ This request has already been processed.",
              ephemeral:
                true
            });
          }

          request.status =
            "processing";

          await interaction.deferUpdate();

          const member =
            await guild.members.fetch(
              request.userId
            ).catch(
              () => null
            );

          if (!member) {

            pendingRequests.delete(
              requestId
            );

            return interaction.message.edit({
              content:
                "❌ Member is no longer in this server.",
              components: []
            });
          }

          try {

            const botMember =
              guild.members.me;

            if (!botMember) {
              throw new Error(
                "Bot member unavailable."
              );
            }

            if (
              !botMember.permissions.has(
                PermissionsBitField.Flags.ManageNicknames
              )
            ) {
              throw new Error(
                "Bot does not have the **Manage Nicknames** permission."
              );
            }

            if (
              member.id ===
              guild.ownerId
            ) {
              throw new Error(
                "Cannot change the server owner's nickname."
              );
            }

            if (
              member.roles.highest.position >=
              botMember.roles.highest.position
            ) {
              throw new Error(
                "Member role is too high. Move the bot's highest role above the member's highest role."
              );
            }

            // ==================================================
            // SAVE OLD NICKNAME
            // ==================================================

            saveOldNickname(
              guild,
              member
            );

            // ==================================================
            // AUTHORIZE BOT CHANGE
            // ==================================================

            markBotNicknameChange(
              guild.id,
              member.id,
              request.finalNickname
            );

            // ==================================================
            // CHANGE NICKNAME
            // ==================================================

            await member.setNickname(
              request.finalNickname,
              `Nickname request ${requestId} approved by ${interaction.user.tag}`
            );

            request.status =
              "approved";

            // ==================================================
            // APPROVED EMBED
            // ==================================================

            const embed =
              new EmbedBuilder()
                .setColor(
                  0x4dff88
                )
                .setTitle(
                  "✅ Nickname Request Approved"
                )
                .setThumbnail(
                  member.displayAvatarURL({
                    extension:
                      "png",
                    size:
                      256
                  })
                )
                .addFields(
                  {
                    name:
                      "👤 User",
                    value:
                      `${member}`,
                    inline:
                      true
                  },
                  {
                    name:
                      "👮 Moderator",
                    value:
                      `${moderator}`,
                    inline:
                      true
                  },
                  {
                    name:
                      "🆔 Request ID",
                    value:
                      requestId,
                    inline:
                      true
                  },
                  {
                    name:
                      "🧾 Old Nickname",
                    value:
                      request.oldNickname ||
                      member.user.username
                  },
                  {
                    name:
                      "🆕 New Nickname",
                    value:
                      request.finalNickname
                  },
                  {
                    name:
                      "✨ Starting Variable",
                    value:
                      /^[^\p{L}\p{N}\s]/u.test(
                        request.finalNickname
                      )
                        ? "🟢 Bot-approved variable allowed"
                        : "None"
                  },
                  {
                    name:
                      "📌 Status",
                    value:
                      "🟢 Approved"
                  }
                )
                .setFooter(
                  footer()
                )
                .setTimestamp();

            // ==================================================
            // EDIT MODERATOR MESSAGE
            // ==================================================

            await interaction.message.edit({
              content:
                "✅ Request approved.",
              embeds: [
                embed
              ],
              components: []
            });

            // ==================================================
            // EDIT USER REQUEST MESSAGE
            // ==================================================

            if (
              request.userMessage
            ) {
              await request.userMessage
                .edit({
                  embeds: [
                    embed
                  ],
                  components: []
                })
                .catch(
                  () => {}
                );
            }

            // ==================================================
            // DM
            // ==================================================

            await member.send({
              embeds: [
                embed
              ]
            }).catch(
              () => {}
            );

            // ==================================================
            // LOG
            // ==================================================

            await sendLog(
              guild,
              config,
              embed
            );

            pendingRequests.delete(
              requestId
            );

          } catch (error) {

            console.error(
              "❌ Approve error:",
              error.message ||
              error
            );

            request.status =
              "failed";

            const errorEmbed =
              new EmbedBuilder()
                .setColor(
                  0xff4e4e
                )
                .setTitle(
                  "❌ Nickname Change Failed"
                )
                .setDescription(
                  `The nickname could not be changed.\n\n**Reason:** ${error.message}`
                )
                .setFooter(
                  footer()
                )
                .setTimestamp();

            await interaction.message.edit({
              content:
                "❌ Nickname change failed.",
              embeds: [
                errorEmbed
              ],
              components: []
            });

            pendingRequests.delete(
              requestId
            );
          }

          return;
        }

        return;
      }

      // ========================================================
      // MODAL SUBMIT
      // ========================================================

      if (
        interaction.isModalSubmit()
      ) {

        if (
          !interaction.customId.startsWith(
            "nick_reject_reason_"
          )
        ) {
          return;
        }

        const requestId =
          interaction.customId.replace(
            "nick_reject_reason_",
            ""
          );

        const request =
          pendingRequests.get(
            requestId
          );

        if (!request) {
          return interaction.reply({
            content:
              "⚠️ This nickname request is no longer active.",
            ephemeral:
              true
          });
        }

        const guild =
          interaction.guild;

        if (!guild) {
          return interaction.reply({
            content:
              "❌ This request is no longer associated with a server.",
            ephemeral:
              true
          });
        }

        if (
          request.guildId !==
          guild.id
        ) {
          return interaction.reply({
            content:
              "❌ This request belongs to another server.",
            ephemeral:
              true
          });
        }

        const config =
          getGuildConfig(
            guild.id
          );

        const moderator =
          await guild.members.fetch(
            interaction.user.id
          ).catch(
            () => null
          );

        if (!moderator) {
          return interaction.reply({
            content:
              "❌ Could not find your server membership.",
            ephemeral:
              true
          });
        }

        if (
          !canApprove(
            moderator,
            config
          )
        ) {
          return interaction.reply({
            content:
              "❌ You do not have permission to reject nickname requests.",
            ephemeral:
              true
          });
        }

        if (
          request.status !==
          "pending"
        ) {
          return interaction.reply({
            content:
              "⚠️ This request has already been processed.",
            ephemeral:
              true
          });
        }

        const reason =
          interaction.fields
            .getTextInputValue(
              "reject_reason"
            )
            .trim();

        if (!reason) {
          return interaction.reply({
            content:
              "❌ Rejection reason cannot be empty.",
            ephemeral:
              true
          });
        }

        request.status =
          "rejected";

        const member =
          await guild.members.fetch(
            request.userId
          ).catch(
            () => null
          );

        if (!member) {

          pendingRequests.delete(
            requestId
          );

          return interaction.reply({
            content:
              "❌ Member is no longer in this server.",
            ephemeral:
              true
          });
        }

        // ======================================================
        // REJECTED EMBED
        // ======================================================

        const embed =
          new EmbedBuilder()
            .setColor(
              0xff4e4e
            )
            .setTitle(
              "❌ Nickname Request Rejected"
            )
            .setThumbnail(
              member.displayAvatarURL({
                extension:
                  "png",
                size:
                  256
              })
            )
            .addFields(
              {
                name:
                  "👤 User",
                value:
                  `${member}`,
                inline:
                  true
              },
              {
                name:
                  "👮 Moderator",
                value:
                  `${moderator}`,
                inline:
                  true
              },
              {
                name:
                  "🆔 Request ID",
                value:
                  requestId,
                inline:
                  true
              },
              {
                name:
                  "🧾 Current Nickname",
                value:
                  request.oldNickname ||
                  member.user.username
              },
              {
                name:
                  "🆕 Requested Nickname",
                value:
                  request.requestedNickname
              },
              {
                name:
                  "📋 Rejection Reason",
                value:
                  reason
              },
              {
                name:
                  "📌 Status",
                value:
                  "🔴 Rejected"
              }
            )
            .setFooter(
              footer()
            )
            .setTimestamp();

        // ======================================================
        // EDIT MODERATOR MESSAGE
        // ======================================================

        await interaction.message.edit({
          content:
            "❌ Request rejected.",
          embeds: [
            embed
          ],
          components: []
        });

        // ======================================================
        // EDIT USER REQUEST MESSAGE
        // ======================================================

        if (
          request.userMessage
        ) {
          await request.userMessage
            .edit({
              embeds: [
                embed
              ],
              components: []
            })
            .catch(
              () => {}
            );
        }

        // ======================================================
        // DM USER
        // ======================================================

        await member.send({
          embeds: [
            embed
          ]
        }).catch(
          () => {}
        );

        // ======================================================
        // LOG
        // ======================================================

        await sendLog(
          guild,
          config,
          embed
        );

        pendingRequests.delete(
          requestId
        );

        return interaction.reply({
          content:
            "✅ Nickname request rejected and the reason has been recorded.",
          ephemeral:
            true
        });
      }

    } catch (error) {

      console.error(
        "❌ Interaction error:",
        error.message ||
        error
      );

      try {

        if (
          interaction.replied ||
          interaction.deferred
        ) {

          await interaction.followUp({
            content:
              "❌ An unexpected error occurred.",
            ephemeral:
              true
          });

        } else {

          await interaction.reply({
            content:
              "❌ An unexpected error occurred.",
            ephemeral:
              true
          });
        }

      } catch {}
    }
  }
);

// ============================================================
// MESSAGE CREATE
// ============================================================
//
// Member simply types:
//
// Shakin Ahmed
//
// 🔥 Shakin
//
// reset
//
// RESET
//
// Reset
//
// ============================================================

client.on(
  "messageCreate",
  async message => {

    try {

      // Ignore DMs
      if (
        !message.guild
      ) {
        return;
      }

      // Ignore bots
      if (
        message.author.bot
      ) {
        return;
      }

      const guild =
        message.guild;

      const config =
        getGuildConfig(
          guild.id
        );

      // ========================================================
      // REQUEST CHANNEL CHECK
      // ========================================================

      if (
        !config.requestChannelId ||
        message.channel.id !==
          config.requestChannelId
      ) {
        return;
      }

      // ========================================================
      // MEMBER
      // ========================================================

      const member =
        await guild.members.fetch(
          message.author.id
        ).catch(
          () => null
        );

      if (!member) {
        return;
      }

      const requestedNickname =
        message.content.trim();

      if (!requestedNickname) {
        return;
      }

      // ========================================================
      // BOT PERMISSION
      // ========================================================

      const botMember =
        guild.members.me;

      if (!botMember) {
        return;
      }

      if (
        !botMember.permissions.has(
          PermissionsBitField.Flags.ManageNicknames
        )
      ) {
        await message.channel.send({
          content:
            `${message.author} ❌ The bot does not have **Manage Nicknames** permission.`
        }).catch(
          () => {}
        );

        return;
      }

      // ========================================================
      // RESET
      // ========================================================
      //
      // reset / RESET / Reset / rEsEt
      //
      // All work.
      //
      // The nickname becomes the user's Discord username,
      // but starting variables are removed.
      //
      // Example:
      //
      // Username: 🔥Homo
      // Reset:
      // Homo
      //
      // ========================================================

      if (
        /^reset$/i.test(
          requestedNickname
        )
      ) {

        // Server owner
        if (
          member.id ===
          guild.ownerId
        ) {

          await message.channel.send({
            content:
              `${message.author} ❌ I cannot change the server owner's nickname.`
          }).catch(
            () => {}
          );

          return;
        }

        // Role hierarchy
        if (
          member.roles.highest.position >=
          botMember.roles.highest.position
        ) {

          await message.channel.send({
            content:
              `${message.author} ❌ I cannot reset your nickname because your highest role is equal to or higher than my highest role.`
          }).catch(
            () => {}
          );

          return;
        }

        const defaultNickname =
          getCleanDefaultNickname(
            member
          );

        const validationError =
          validateNickname(
            defaultNickname
          );

        if (validationError) {

          await message.channel.send({
            content:
              `${message.author} ${validationError}`
          }).catch(
            () => {}
          );

          return;
        }

        const oldNickname =
          member.nickname ||
          member.user.username;

        // Save history
        saveOldNickname(
          guild,
          member
        );

        // Mark as authorized bot change
        markBotNicknameChange(
          guild.id,
          member.id,
          defaultNickname
        );

        try {

          await member.setNickname(
            defaultNickname,
            `Nickname reset by ${message.author.tag}`
          );

          const resetEmbed =
            new EmbedBuilder()
              .setColor(
                0x4dff88
              )
              .setTitle(
                "🔄 Nickname Reset"
              )
              .setThumbnail(
                member.displayAvatarURL({
                  extension:
                    "png",
                  size:
                    256
                })
              )
              .addFields(
                {
                  name:
                    "👤 User",
                  value:
                    `${member}`,
                  inline:
                    true
                },
                {
                  name:
                    "🧾 Previous Nickname",
                  value:
                    oldNickname,
                  inline:
                    true
                },
                {
                  name:
                    "🆕 Default Nickname",
                  value:
                    defaultNickname,
                  inline:
                    true
                },
                {
                  name:
                    "📌 Action",
                  value:
                    "Starting variables were removed from the default username.",
                  inline:
                    false
                }
              )
              .setFooter(
                footer()
              )
              .setTimestamp();

            await message.channel.send({
              embeds: [
                resetEmbed
              ],
              allowedMentions: {
                users: []
              }
            }).catch(
              () => {}
            );

            await sendLog(
              guild,
              config,
              resetEmbed
            );

            await member.send({
              embeds: [
                resetEmbed
              ]
            }).catch(
              () => {}
            );

          } catch (error) {

            // Remove authorization marker
            authorizedBotChanges.delete(
              botChangeKey(
                guild.id,
                member.id
              )
            );

            console.error(
              "❌ Reset nickname error:",
              error.message ||
              error
            );

            await message.channel.send({
              content:
                `${message.author} ❌ Nickname reset failed.\n\n**Reason:** ${error.message}`
            }).catch(
              () => {}
            );
          }

        } catch (error) {

          console.error(
            "❌ Reset error:",
            error.message ||
            error
          );
        }

        return;
      }

      // ========================================================
      // NORMALIZE
      // ========================================================

      const finalNickname =
        normalizeNickname(
          requestedNickname
        );

      if (!finalNickname) {

        await message.channel.send({
          content:
            `${message.author} ❌ Your nickname must contain at least one letter or number.`
        }).catch(
          () => {}
        );

        return;
      }

      // ========================================================
      // VALIDATE
      // ========================================================

      const validationError =
        validateNickname(
          finalNickname
        );

      if (validationError) {

        await message.channel.send({
          content:
            `${message.author} ${validationError}`
        }).catch(
          () => {}
        );

        return;
      }

      // ========================================================
      // SERVER OWNER
      // ========================================================

      if (
        member.id ===
        guild.ownerId
      ) {

        await message.channel.send({
          content:
            `${message.author} ❌ I cannot change the server owner's nickname.`
        }).catch(
          () => {}
        );

        return;
      }

      // ========================================================
      // ROLE HIERARCHY
      // ========================================================

      if (
        member.roles.highest.position >=
        botMember.roles.highest.position
      ) {

        await message.channel.send({
          content:
            `${message.author} ❌ I cannot change your nickname because your highest role is equal to or higher than my highest role.`
        }).catch(
          () => {}
        );

        return;
      }

      // ========================================================
      // REQUEST ID
      // ========================================================

      const requestId =
        createRequestId();

      const oldNickname =
        member.nickname ||
        member.user.username;

      const startingVariableRemoved =
        requestedNickname !==
        finalNickname;

      const submittedAt =
        Math.floor(
          Date.now() / 1000
        );

      // ========================================================
      // REQUEST EMBED
      // ========================================================

      const requestEmbed =
        new EmbedBuilder()
          .setColor(
            0x2bafff
          )
          .setTitle(
            "📝 Nickname Change Request"
          )
          .setThumbnail(
            member.displayAvatarURL({
              extension:
                "png",
              size:
                256
            })
          )
          .addFields(
            {
              name:
                "👤 User",
              value:
                `${member}`,
              inline:
                true
            },
            {
              name:
                "🆔 Request ID",
              value:
                requestId,
              inline:
                true
            },
            {
              name:
                "🧾 Current Nickname",
              value:
                oldNickname
            },
            {
              name:
                "🆕 Requested Nickname",
              value:
                requestedNickname
            },
            {
              name:
                "🔐 Final Nickname",
              value:
                finalNickname
            },
            {
              name:
                "✨ Starting Variable",
              value:
                startingVariableRemoved
                  ? "⚠️ Removed from request"
                  : "None",
              inline:
                true
            },
            {
              name:
                "📌 Status",
              value:
                "🟡 Pending Review",
              inline:
                true
            },
            {
              name:
                "⏱️ Submitted",
              value:
                `<t:${submittedAt}:F>`
            }
          )
          .setFooter({
            text:
              "Waiting for an authorized moderator to approve or reject."
          })
          .setTimestamp();

      // ========================================================
      // USER MESSAGE
      // ========================================================

      const userReply =
        await message.channel.send({
          embeds: [
            requestEmbed
          ],
          allowedMentions: {
            users: []
          }
        });

      // ========================================================
      // BUTTONS
      // ========================================================

      const buttons =
        new ActionRowBuilder()
          .addComponents(

            new ButtonBuilder()
              .setCustomId(
                `nick_accept_${requestId}`
              )
              .setLabel(
                "Approve"
              )
              .setEmoji(
                "✅"
              )
              .setStyle(
                ButtonStyle.Success
              ),

            new ButtonBuilder()
              .setCustomId(
                `nick_reject_${requestId}`
              )
              .setLabel(
                "Reject"
              )
              .setEmoji(
                "❌"
              )
              .setStyle(
                ButtonStyle.Danger
              )
          );

      // ========================================================
      // LOG CHANNEL
      // ========================================================

      const logChannel =
        config.logChannelId
          ? guild.channels.cache.get(
              config.logChannelId
            )
          : null;

      if (
        !logChannel ||
        !logChannel.isTextBased()
      ) {

        await userReply.edit({
          embeds: [

            new EmbedBuilder()
              .setColor(
                0xffb84d
              )
              .setTitle(
                "⚠️ Nickname System Not Configured"
              )
              .setDescription(
                "The nickname log/moderator channel has not been configured by the server administrator."
              )
              .setFooter(
                footer()
              )
              .setTimestamp()
          ]
        }).catch(
          () => {}
        );

        return;
      }

      // ========================================================
      // APPROVER ROLE MENTIONS
      // ========================================================

      const roleMentions =
        config.approverRoleIds.length
          ? config.approverRoleIds
              .map(
                id =>
                  `<@&${id}>`
              )
              .join(
                " "
              )
          : "";

      // ========================================================
      // SEND MODERATOR REQUEST
      // ========================================================

      let moderatorMessage;

      try {

        moderatorMessage =
          await logChannel.send({

            content:
              roleMentions
                ? `${roleMentions}\n🔔 **New nickname change request.**`
                : "🔔 **New nickname change request.**",

            embeds: [
              requestEmbed
            ],

            components: [
              buttons
            ],

            allowedMentions: {
              roles:
                config.approverRoleIds
            }
          });

      } catch (error) {

        console.error(
          "❌ Failed to send moderator request:",
          error.message ||
          error
        );

        await userReply.edit({
          embeds: [

            new EmbedBuilder()
              .setColor(
                0xff4e4e
              )
              .setTitle(
                "❌ Nickname Request Failed"
              )
              .setDescription(
                "I could not send your request to the moderator channel.\n\nPlease contact a server administrator."
              )
              .setFooter(
                footer()
              )
              .setTimestamp()
          ]
        }).catch(
          () => {}
        );

        return;
      }

      // ========================================================
      // SAVE REQUEST
      // ========================================================

      pendingRequests.set(
        requestId,
        {

          guildId:
            guild.id,

          userId:
            member.id,

          oldNickname,

          requestedNickname,

          finalNickname,

          userMessage:
            userReply,

          moderatorMessageId:
            moderatorMessage.id,

          status:
            "pending",

          createdAt:
            Date.now()
        }
      );

      // ========================================================
      // EXPIRE AFTER 3 HOURS
      // ========================================================

      setTimeout(
        async () => {

          const request =
            pendingRequests.get(
              requestId
            );

          if (!request) {
            return;
          }

          if (
            request.status !==
            "pending"
          ) {
            return;
          }

          request.status =
            "expired";

          pendingRequests.delete(
            requestId
          );

          const expiredEmbed =
            new EmbedBuilder()
              .setColor(
                0x808080
              )
              .setTitle(
                "⌛ Nickname Request Expired"
              )
              .setDescription(
                "This nickname request was not processed within 3 hours."
              )
              .addFields({
                name:
                  "🆔 Request ID",
                value:
                  requestId
              })
              .setFooter(
                footer()
              )
              .setTimestamp();

          await moderatorMessage.edit({
            content:
              "⌛ Request expired.",
            embeds: [
              expiredEmbed
            ],
            components: []
          }).catch(
            () => {}
          );

          await request.userMessage
            .edit({
              embeds: [
                expiredEmbed
              ],
              components: []
            })
            .catch(
              () => {}
            );

        },
        3 * 60 * 60 * 1000
      );

    } catch (error) {

      console.error(
        "❌ messageCreate error:",
        error.message ||
        error
      );
    }
  }
);

// ============================================================
// AUTOMATIC STARTING VARIABLE PROTECTION
// ============================================================
//
// Manual:
//
// 🔥Homo
// ↓
// Homo
//
// 『Shakin
// ↓
// Shakin
//
// But:
//
// Bot approves:
// 🔥Homo
// ↓
// 🔥Homo
//
// The bot-approved nickname stays because
// it is marked as an authorized bot change.
//
// ============================================================

client.on(
  "guildMemberUpdate",
  async (
    oldMember,
    newMember
  ) => {

    try {

      // Ignore bots
      if (
        newMember.user.bot
      ) {
        return;
      }

      // Only nickname changes
      if (
        oldMember.nickname ===
        newMember.nickname
      ) {
        return;
      }

      // ========================================================
      // CHECK AUTHORIZED BOT CHANGE
      // ========================================================

      if (
        consumeBotNicknameChange(
          newMember.guild.id,
          newMember.id,
          newMember.nickname
        )
      ) {
        console.log(
          `✅ Authorized bot nickname change accepted: ${newMember.user.tag} -> ${newMember.nickname}`
        );

        return;
      }

      // ========================================================
      // NO NICKNAME
      // ========================================================

      if (
        !newMember.nickname
      ) {
        return;
      }

      // ========================================================
      // REMOVE MANUAL STARTING VARIABLES
      // ========================================================

      const cleanNickname =
        removeStartingVariables(
          newMember.nickname
        );

      // Nothing changed
      if (
        cleanNickname ===
        newMember.nickname
      ) {
        return;
      }

      // Cannot set empty nickname
      if (
        !cleanNickname
      ) {
        return;
      }

      const botMember =
        newMember.guild.members.me;

      if (!botMember) {
        return;
      }

      if (
        !botMember.permissions.has(
          PermissionsBitField.Flags.ManageNicknames
        )
      ) {
        console.log(
          `⚠️ Missing Manage Nicknames permission in ${newMember.guild.name}`
        );

        return;
      }

      // Server owner
      if (
        newMember.id ===
        newMember.guild.ownerId
      ) {
        return;
      }

      // Role hierarchy
      if (
        newMember.roles.highest.position >=
        botMember.roles.highest.position
      ) {

        console.log(
          `⚠️ Cannot auto-clean ${newMember.user.tag} in ${newMember.guild.name} - role hierarchy`
        );

        return;
      }

      const oldNickname =
        newMember.nickname;

      // Mark bot change
      markBotNicknameChange(
        newMember.guild.id,
        newMember.id,
        cleanNickname
      );

      await newMember.setNickname(
        cleanNickname,
        "Removed unauthorized starting variables"
      );

      console.log(
        `🧹 ${newMember.guild.name} | ${newMember.user.tag} | ${oldNickname} -> ${cleanNickname}`
      );

      const config =
        getGuildConfig(
          newMember.guild.id
        );

      await sendAutoRemoveLog(
        newMember.guild,
        config,
        newMember,
        oldNickname,
        cleanNickname
      );

    } catch (error) {

      console.error(
        "❌ Auto nickname protection error:",
        error.message ||
        error
      );
    }
  }
);

// ============================================================
// GUILD CREATE
// ============================================================

client.on(
  "guildCreate",
  async guild => {

    try {

      getGuildConfig(
        guild.id
      );

      console.log(
        `➕ Joined server: ${guild.name} (${guild.id})`
      );

      await registerGuildCommands(
        guild
      );

      await scanGuildMembers(
        guild
      );

    } catch (error) {

      console.error(
        "❌ Guild join error:",
        error.message ||
        error
      );
    }
  }
);

// ============================================================
// GUILD DELETE
// ============================================================

client.on(
  "guildDelete",
  guild => {

    if (
      guildConfigs[guild.id]
    ) {

      delete guildConfigs[
        guild.id
      ];

      saveConfigs();
    }

    console.log(
      `➖ Removed configuration for: ${guild.name}`
    );
  }
);

// ============================================================
// EXPRESS SERVER
// ============================================================

const app =
  express();

app.get(
  "/",
  (
    req,
    res
  ) => {

    res.status(
      200
    ).send(
      "Nickname Management Bot is online ✅"
    );
  }
);

app.get(
  "/health",
  (
    req,
    res
  ) => {

    res.status(
      200
    ).json({

      status:
        "online",

      bot:
        client.user
          ? client.user.tag
          : "starting",

      servers:
        client.guilds.cache.size,

      uptime:
        process.uptime()
    });
  }
);

const PORT =
  process.env.PORT ||
  3000;

app.listen(
  PORT,
  () => {

    console.log(
      `🌐 Web server running on port ${PORT}`
    );
  }
);

// ============================================================
// ERROR HANDLERS
// ============================================================

process.on(
  "unhandledRejection",
  error => {

    console.error(
      "❌ Unhandled Promise Rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {

    console.error(
      "❌ Uncaught Exception:",
      error
    );
  }
);

// ============================================================
// SHUTDOWN
// ============================================================

function shutdown(
  signal
) {

  console.log(
    `🛑 ${signal} received. Saving data...`
  );

  saveConfigs();
  saveHistory();

  client.destroy();

  process.exit(0);
}

process.on(
  "SIGINT",
  () =>
    shutdown(
      "SIGINT"
    )
);

process.on(
  "SIGTERM",
  () =>
    shutdown(
      "SIGTERM"
    )
);

// ============================================================
// LOGIN
// ============================================================

console.log(
  "🔐 Starting Discord bot..."
);

client.login(
  TOKEN
);
