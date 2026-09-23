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
// - Reset uses cleaned global/display name
// - Nickname history
// - Moderator logs
// - User DM notifications
// - Existing member scan
// - New member protection
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

const DATA_DIR = path.join(__dirname, "data");

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
        JSON.stringify(fallback, null, 2)
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
      JSON.stringify(data, null, 2)
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

let guildConfigs = loadJSON(
  CONFIG_FILE,
  {}
);

let nickHistory = loadJSON(
  HISTORY_FILE,
  {}
);

// ============================================================
// SAVE
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
// DEFAULT SERVER CONFIG
// ============================================================

function createDefaultConfig() {
  return {
    requestChannelId: null,
    logChannelId: null,
    approverRoleIds: []
  };
}

// ============================================================
// GET SERVER CONFIG
// ============================================================

function getGuildConfig(guildId) {
  if (!guildConfigs[guildId]) {
    guildConfigs[guildId] =
      createDefaultConfig();

    saveConfigs();
  }

  const defaults =
    createDefaultConfig();

  guildConfigs[guildId] = {
    ...defaults,
    ...guildConfigs[guildId]
  };

  return guildConfigs[guildId];
}

// ============================================================
// ADMIN CHECK
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
      member.roles.cache.has(roleId)
  );
}

// ============================================================
// APPROVER CHECK
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
// REMOVE ONLY STARTING VARIABLES
// ============================================================
//
// Examples:
//
// 🔥Shakin      -> Shakin
// ★ Shakin      -> Shakin
// 『Shakin      -> Shakin
// !Shakin       -> Shakin
//
// Shakin★       -> Shakin★
// Sh★akin       -> Sh★akin
//
// Only beginning symbols are removed.
// ============================================================

function removeStartingVariables(
  nickname
) {
  if (!nickname) {
    return "";
  }

  let result =
    String(nickname).trim();

  result = result.replace(
    /^[^\p{L}\p{N}\s]+/gu,
    ""
  );

  return result.trim();
}

// ============================================================
// GET CLEAN DEFAULT NAME
// ============================================================
//
// Priority:
//
// 1. Discord Global Display Name
// 2. Discord Username
//
// Example:
//
// Global Name: 🔥 Shakin
// Result: Shakin
// ============================================================

function getCleanDefaultNickname(
  member
) {
  if (!member || !member.user) {
    return null;
  }

  const baseName =
    member.user.globalName ||
    member.user.username ||
    "";

  const cleaned =
    removeStartingVariables(
      baseName
    );

  return (
    cleaned ||
    member.user.username ||
    null
  );
}

// ============================================================
// VALIDATE NICKNAME
// ============================================================

function validateNickname(
  nickname
) {
  if (!nickname) {
    return "❌ Nickname cannot be empty.";
  }

  if (nickname.length > 32) {
    return "❌ Nickname cannot be longer than **32 characters**.";
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
// SAVE OLD NICKNAME
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
    guildId: guild.id,
    userId: member.id,
    nickname:
      member.nickname ||
      member.user.globalName ||
      member.user.username,
    savedAt: Date.now()
  };

  saveHistory();
}

// ============================================================
// PENDING REQUESTS
// ============================================================

const pendingRequests =
  new Map();

// ============================================================
// BOT-AUTHORIZED NICKNAME CHANGES
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

function removeBotNicknameMarker(
  guildId,
  userId
) {
  authorizedBotChanges.delete(
    botChangeKey(
      guildId,
      userId
    )
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
// BOT MANAGE NICKNAME PERMISSION
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
// CHECK MEMBER CAN BE MANAGED
// ============================================================

function canBotManageMember(
  guild,
  member
) {
  const botMember =
    guild.members.me;

  if (!botMember) {
    return {
      ok: false,
      reason:
        "Bot member is unavailable."
    };
  }

  if (
    !botMember.permissions.has(
      PermissionsBitField.Flags.ManageNicknames
    )
  ) {
    return {
      ok: false,
      reason:
        "Bot does not have **Manage Nicknames** permission."
    };
  }

  if (
    member.id === guild.ownerId
  ) {
    return {
      ok: false,
      reason:
        "I cannot change the server owner's nickname."
    };
  }

  if (
    member.roles.highest.position >=
    botMember.roles.highest.position
  ) {
    return {
      ok: false,
      reason:
        "Your highest role is equal to or higher than my highest role."
    };
  }

  return {
    ok: true
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
        .setColor(0xffb84d)
        .setTitle(
          "🧹 Unauthorized Variable Removed"
        )
        .setThumbnail(
          member.displayAvatarURL({
            extension: "png",
            size: 256
          })
        )
        .addFields(
          {
            name: "👤 Member",
            value: `${member}`,
            inline: true
          },
          {
            name: "🧾 Old Nickname",
            value:
              oldNickname ||
              member.user.username,
            inline: false
          },
          {
            name: "🆕 New Nickname",
            value: cleanNickname,
            inline: false
          },
          {
            name: "📌 Action",
            value:
              "Starting variable was automatically removed because the nickname was not approved through the bot.",
            inline: false
          }
        )
        .setFooter(footer())
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
// SLASH COMMANDS
// ============================================================

const commands = [

  // ==========================================================
  // /nicksetup
  // ==========================================================

  new SlashCommandBuilder()
    .setName("nicksetup")
    .setDescription(
      "Configure nickname system for this server."
    )
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.Administrator.toString()
    )

    .addSubcommand(sub =>
      sub
        .setName("request-channel")
        .setDescription(
          "Set nickname request channel."
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription(
              "Nickname request channel."
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName("log-channel")
        .setDescription(
          "Set nickname moderator/log channel."
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription(
              "Nickname log channel."
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName("approver-add")
        .setDescription(
          "Allow a role to approve/reject requests."
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription(
              "Approver role."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName("approver-remove")
        .setDescription(
          "Remove a role from approvers."
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription(
              "Role to remove."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName("show")
        .setDescription(
          "Show current nickname configuration."
        )
    ),

  // ==========================================================
  // /nickpanel
  // ==========================================================

  new SlashCommandBuilder()
    .setName("nickpanel")
    .setDescription(
      "Send nickname request panel."
    )
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.Administrator.toString()
    )
    .addChannelOption(option =>
      option
        .setName("channel")
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
// REGISTER COMMANDS
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
        body: commands
      }
    );

    console.log(
      `✅ Slash commands registered: ${guild.name} (${guild.id})`
    );

  } catch (error) {
    console.error(
      `❌ Slash command registration failed in ${guild.name}:`,
      error.message ||
      error
    );
  }
}

// ============================================================
// CLEAN MEMBER DISPLAY
// ============================================================
//
// If member has a server nickname:
//     clean that nickname.
//
// If member has NO server nickname:
//     check global/display name.
//     If global name starts with variable,
//     create a clean server nickname.
//
// This makes the server display clean even if the
// Discord global name contains starting variables.
// ============================================================

async function cleanMemberDisplay(
  guild,
  member,
  reason
) {
  try {
    if (
      !member ||
      member.user.bot
    ) {
      return false;
    }

    const config =
      getGuildConfig(
        guild.id
      );

    const permission =
      canBotManageMember(
        guild,
        member
      );

    if (!permission.ok) {
      return false;
    }

    // --------------------------------------------------------
    // Existing server nickname
    // --------------------------------------------------------

    if (member.nickname) {

      const cleanNickname =
        removeStartingVariables(
          member.nickname
        );

      if (
        !cleanNickname ||
        cleanNickname ===
          member.nickname
      ) {
        return false;
      }

      const oldNickname =
        member.nickname;

      markBotNicknameChange(
        guild.id,
        member.id,
        cleanNickname
      );

      try {

        await member.setNickname(
          cleanNickname,
          reason
        );

      } catch (error) {

        removeBotNicknameMarker(
          guild.id,
          member.id
        );

        throw error;
      }

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

      return true;
    }

    // --------------------------------------------------------
    // No server nickname
    // Check global/display name
    // --------------------------------------------------------

    const globalName =
      member.user.globalName ||
      member.user.username ||
      "";

    const cleanGlobalName =
      removeStartingVariables(
        globalName
      );

    if (
      !cleanGlobalName ||
      cleanGlobalName ===
        globalName
    ) {
      return false;
    }

    markBotNicknameChange(
      guild.id,
      member.id,
      cleanGlobalName
    );

    try {

      await member.setNickname(
        cleanGlobalName,
        reason
      );

    } catch (error) {

      removeBotNicknameMarker(
        guild.id,
        member.id
      );

      throw error;
    }

    console.log(
      `🧹 ${guild.name} | ${member.user.tag}: global name "${globalName}" -> server nickname "${cleanGlobalName}"`
    );

    await sendAutoRemoveLog(
      guild,
      config,
      member,
      globalName,
      cleanGlobalName
    );

    return true;

  } catch (error) {

    console.error(
      `❌ Could not clean ${member?.user?.tag || member?.id || "member"}:`,
      error.message ||
      error
    );

    return false;
  }
}

// ============================================================
// SCAN SERVER MEMBERS
// ============================================================

async function scanGuildMembers(
  guild
) {
  try {

    console.log(
      `🔎 Scanning members in ${guild.name}...`
    );

    if (!botCanManageNickname(guild)) {
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

      if (
        member.user.bot
      ) {
        continue;
      }

      const result =
        await cleanMemberDisplay(
          guild,
          member,
          "Initial nickname protection scan"
        );

      if (result) {
        changed++;
      }

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            250
          )
      );
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
  "ready",
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

    // --------------------------------------------------------
    // Register commands
    // --------------------------------------------------------

    for (
      const guild of client.guilds.cache.values()
    ) {
      await registerGuildCommands(
        guild
      );
    }

    // --------------------------------------------------------
    // Scan members
    // --------------------------------------------------------

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

      // ======================================================
      // MODAL SUBMIT
      // ======================================================

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
              "⚠️ This nickname request is no longer active. It may have expired or the bot may have restarted.",
            ephemeral: true
          });
        }

        const guild =
          interaction.guild;

        if (!guild) {
          return interaction.reply({
            content:
              "❌ This request is no longer associated with a server.",
            ephemeral: true
          });
        }

        if (
          request.guildId !==
          guild.id
        ) {
          return interaction.reply({
            content:
              "❌ This request belongs to another server.",
            ephemeral: true
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
            ephemeral: true
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
            ephemeral: true
          });
        }

        if (
          request.status !==
          "pending"
        ) {
          return interaction.reply({
            content:
              "⚠️ This request has already been processed.",
            ephemeral: true
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
            ephemeral: true
          });
        }

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
            ephemeral: true
          });
        }

        request.status =
          "rejected";

        // ====================================================
        // REJECT EMBED
        // ====================================================

        const embed =
          new EmbedBuilder()
            .setColor(0xff4e4e)
            .setTitle(
              "❌ Nickname Request Rejected"
            )
            .setThumbnail(
              member.displayAvatarURL({
                extension: "png",
                size: 256
              })
            )
            .addFields(
              {
                name: "👤 User",
                value: `${member}`,
                inline: true
              },
              {
                name: "👮 Moderator",
                value: `${moderator}`,
                inline: true
              },
              {
                name: "🆔 Request ID",
                value: requestId,
                inline: true
              },
              {
                name: "🧾 Current Nickname",
                value:
                  request.oldNickname ||
                  member.user.username
              },
              {
                name: "🆕 Requested Nickname",
                value:
                  request.requestedNickname
              },
              {
                name: "📋 Rejection Reason",
                value: reason
              },
              {
                name: "📌 Status",
                value: "🔴 Rejected"
              }
            )
            .setFooter(footer())
            .setTimestamp();

        // ====================================================
        // EDIT MODERATOR MESSAGE
        // ====================================================

        if (
          request.moderatorMessage
        ) {
          await request.moderatorMessage
            .edit({
              content:
                "❌ Request rejected.",
              embeds: [embed],
              components: []
            })
            .catch(
              () => {}
            );
        }

        // ====================================================
        // EDIT USER MESSAGE
        // ====================================================

        if (
          request.userMessage
        ) {
          await request.userMessage
            .edit({
              embeds: [embed],
              components: []
            })
            .catch(
              () => {}
            );
        }

        // ====================================================
        // DM
        // ====================================================

        await member.send({
          embeds: [embed]
        }).catch(
          () => {}
        );

        // ====================================================
        // LOG
        // ====================================================

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
          ephemeral: true
        });
      }

      // ======================================================
      // SLASH COMMANDS
      // ======================================================

      if (
        interaction.isChatInputCommand()
      ) {

        if (
          !interaction.guild
        ) {
          return interaction.reply({
            content:
              "❌ This command can only be used inside a server.",
            ephemeral: true
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
            ephemeral: true
          });
        }

        if (
          !isAdmin(member)
        ) {
          return interaction.reply({
            content:
              "❌ Only server administrators can configure this bot.",
            ephemeral: true
          });
        }

        const config =
          getGuildConfig(
            guild.id
          );

        // ====================================================
        // NICKSETUP
        // ====================================================

        if (
          interaction.commandName ===
          "nicksetup"
        ) {

          const sub =
            interaction.options.getSubcommand();

          // --------------------------------------------------
          // REQUEST CHANNEL
          // --------------------------------------------------

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
              ephemeral: true
            });
          }

          // --------------------------------------------------
          // LOG CHANNEL
          // --------------------------------------------------

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
              ephemeral: true
            });
          }

          // --------------------------------------------------
          // APPROVER ADD
          // --------------------------------------------------

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
              ephemeral: true
            });
          }

          // --------------------------------------------------
          // APPROVER REMOVE
          // --------------------------------------------------

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
              ephemeral: true
            });
          }

          // --------------------------------------------------
          // SHOW
          // --------------------------------------------------

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
                    .join(", ")
                : "Not configured";

            const embed =
              new EmbedBuilder()
                .setColor(0x2bafff)
                .setTitle(
                  "⚙️ Nickname System Configuration"
                )
                .setDescription(
                  "Starting variables are protected automatically. Only nicknames approved through this bot can keep starting variables."
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
                      "✨ Variable Protection",
                    value:
                      "🟢 Always ON"
                  },
                  {
                    name:
                      "🔄 Reset",
                    value:
                      "Type `reset` to use your cleaned Discord display/default name."
                  }
                )
                .setFooter(
                  footer()
                )
                .setTimestamp();

            return interaction.reply({
              embeds: [embed],
              ephemeral: true
            });
          }
        }

        // ====================================================
        // NICKPANEL
        // ====================================================

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
              ephemeral: true
            });
          }

          const embed =
            new EmbedBuilder()
              .setColor(0x2bafff)
              .setTitle(
                "📝 Nickname Change"
              )
              .setDescription(
                [
                  "Send your requested nickname in this channel.",
                  "",
                  "**No command or prefix is required.**",
                  "",
                  "**Examples:**",
                  "`Shakin Ahmed`",
                  "`🔥 Shakin`",
                  "`★Shakin`",
                  "",
                  "Starting variables are allowed only when the request is approved through this bot.",
                  "",
                  "**Reset your nickname:**",
                  "`reset`",
                  "",
                  "Reset works regardless of capitalization."
                ].join("\n")
              )
              .setFooter(
                footer()
              )
              .setTimestamp();

          await channel.send({
            embeds: [embed]
          });

          return interaction.reply({
            content:
              `✅ Nickname panel sent to ${channel}.`,
            ephemeral: true
          });
        }

        return;
      }

      // ======================================================
      // BUTTONS
      // ======================================================

      if (
        interaction.isButton()
      ) {

        const customId =
          interaction.customId;

        // ====================================================
        // REJECT BUTTON
        // ====================================================

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
              ephemeral: true
            });
          }

          const guild =
            interaction.guild;

          if (!guild) {
            return interaction.reply({
              content:
                "❌ This request is no longer associated with a server.",
              ephemeral: true
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
              ephemeral: true
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
              ephemeral: true
            });
          }

          if (
            request.status !==
            "pending"
          ) {
            return interaction.reply({
              content:
                "⚠️ This request has already been processed.",
              ephemeral: true
            });
          }

          // -----------------------------------------------
          // SHOW REJECT MODAL
          // -----------------------------------------------

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
              .setMinLength(3)
              .setMaxLength(500)
              .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder()
              .addComponents(
                reasonInput
              )
          );

          return interaction.showModal(
            modal
          );
        }

        // ====================================================
        // APPROVE BUTTON
        // ====================================================

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
              ephemeral: true
            });
          }

          const guild =
            interaction.guild;

          if (!guild) {
            return interaction.reply({
              content:
                "❌ This request is no longer associated with a server.",
              ephemeral: true
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
              ephemeral: true
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
                "❌ You do not have permission to approve nickname requests.",
              ephemeral: true
            });
          }

          if (
            request.status !==
            "pending"
          ) {
            return interaction.reply({
              content:
                "⚠️ This request has already been processed.",
              ephemeral: true
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

            const permission =
              canBotManageMember(
                guild,
                member
              );

            if (!permission.ok) {
              throw new Error(
                permission.reason
              );
            }

            // ---------------------------------------------
            // SAVE OLD NICKNAME
            // ---------------------------------------------

            saveOldNickname(
              guild,
              member
            );

            // ---------------------------------------------
            // IMPORTANT
            //
            // requestedNickname is NOT normalized.
            //
            // Example:
            //
            // User requests:
            // 🔥Shakin
            //
            // Moderator approves:
            // 🔥Shakin
            //
            // It stays exactly as requested.
            // ---------------------------------------------

            markBotNicknameChange(
              guild.id,
              member.id,
              request.finalNickname
            );

            try {

              await member.setNickname(
                request.finalNickname,
                `Nickname request ${requestId} approved by ${interaction.user.tag}`
              );

            } catch (error) {

              removeBotNicknameMarker(
                guild.id,
                member.id
              );

              throw error;
            }

            request.status =
              "approved";

            const hasStartingVariable =
              /^[^\p{L}\p{N}\s]/u.test(
                request.finalNickname
              );

            const embed =
              new EmbedBuilder()
                .setColor(0x4dff88)
                .setTitle(
                  "✅ Nickname Request Approved"
                )
                .setThumbnail(
                  member.displayAvatarURL({
                    extension: "png",
                    size: 256
                  })
                )
                .addFields(
                  {
                    name: "👤 User",
                    value: `${member}`,
                    inline: true
                  },
                  {
                    name: "👮 Moderator",
                    value: `${moderator}`,
                    inline: true
                  },
                  {
                    name: "🆔 Request ID",
                    value: requestId,
                    inline: true
                  },
                  {
                    name: "🧾 Old Nickname",
                    value:
                      request.oldNickname ||
                      member.user.username
                  },
                  {
                    name: "🆕 New Nickname",
                    value:
                      request.finalNickname
                  },
                  {
                    name:
                      "✨ Starting Variable",
                    value:
                      hasStartingVariable
                        ? "🟢 Bot-approved variable allowed"
                        : "None"
                  },
                  {
                    name: "📌 Status",
                    value:
                      "🟢 Approved"
                  }
                )
                .setFooter(
                  footer()
                )
                .setTimestamp();

            // ---------------------------------------------
            // MODERATOR MESSAGE
            // ---------------------------------------------

            await interaction.message.edit({
              content:
                "✅ Request approved.",
              embeds: [embed],
              components: []
            });

            // ---------------------------------------------
            // USER REQUEST MESSAGE
            // ---------------------------------------------

            if (
              request.userMessage
            ) {
              await request.userMessage
                .edit({
                  embeds: [embed],
                  components: []
                })
                .catch(
                  () => {}
                );
            }

            // ---------------------------------------------
            // DM
            // ---------------------------------------------

            await member.send({
              embeds: [embed]
            }).catch(
              () => {}
            );

            // ---------------------------------------------
            // LOG
            // ---------------------------------------------

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

            removeBotNicknameMarker(
              guild.id,
              member.id
            );

            const errorEmbed =
              new EmbedBuilder()
                .setColor(0xff4e4e)
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
              embeds: [errorEmbed],
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
            ephemeral: true
          });

        } else {

          await interaction.reply({
            content:
              "❌ An unexpected error occurred.",
            ephemeral: true
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
// User simply types:
//
// Shakin
// 🔥Shakin
// ★ Shakin
// reset
//
// ============================================================

client.on(
  "messageCreate",
  async message => {

    try {

      // --------------------------------------------------------
      // Ignore DMs
      // --------------------------------------------------------

      if (
        !message.guild
      ) {
        return;
      }

      // --------------------------------------------------------
      // Ignore bots
      // --------------------------------------------------------

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

      // --------------------------------------------------------
      // Request channel only
      // --------------------------------------------------------

      if (
        !config.requestChannelId ||
        message.channel.id !==
          config.requestChannelId
      ) {
        return;
      }

      // --------------------------------------------------------
      // Member
      // --------------------------------------------------------

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

      // --------------------------------------------------------
      // BOT
      // --------------------------------------------------------

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

      if (
        /^reset$/i.test(
          requestedNickname
        )
      ) {

        const permission =
          canBotManageMember(
            guild,
            member
          );

        if (!permission.ok) {

          await message.channel.send({
            content:
              `${message.author} ❌ ${permission.reason}`
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
          member.user.globalName ||
          member.user.username;

        saveOldNickname(
          guild,
          member
        );

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
              .setColor(0x4dff88)
              .setTitle(
                "🔄 Nickname Reset"
              )
              .setThumbnail(
                member.displayAvatarURL({
                  extension: "png",
                  size: 256
                })
              )
              .addFields(
                {
                  name: "👤 User",
                  value: `${member}`,
                  inline: true
                },
                {
                  name:
                    "🧾 Previous Nickname",
                  value: oldNickname,
                  inline: true
                },
                {
                  name:
                    "🆕 Default Nickname",
                  value: defaultNickname,
                  inline: true
                },
                {
                  name: "📌 Action",
                  value:
                    "The default/display name was cleaned from starting variables.",
                  inline: false
                }
              )
              .setFooter(
                footer()
              )
              .setTimestamp();

          await message.channel.send({
            embeds: [resetEmbed],
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
            embeds: [resetEmbed]
          }).catch(
            () => {}
          );

        } catch (error) {

          removeBotNicknameMarker(
            guild.id,
            member.id
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

        return;
      }

      // ========================================================
      // NORMAL REQUEST
      // ========================================================
      //
      // IMPORTANT:
      //
      // DO NOT REMOVE STARTING VARIABLES HERE.
      //
      // User can request:
      //
      // 🔥Shakin
      //
      // Moderator decides whether to approve it.
      //
      // ========================================================

      const finalNickname =
        requestedNickname;

      // --------------------------------------------------------
      // Validate
      // --------------------------------------------------------

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

      // --------------------------------------------------------
      // Member permission
      // --------------------------------------------------------

      const permission =
        canBotManageMember(
          guild,
          member
        );

      if (!permission.ok) {

        await message.channel.send({
          content:
            `${message.author} ❌ ${permission.reason}`
        }).catch(
          () => {}
        );

        return;
      }

      // --------------------------------------------------------
      // Request ID
      // --------------------------------------------------------

      const requestId =
        createRequestId();

      const oldNickname =
        member.nickname ||
        member.user.globalName ||
        member.user.username;

      const submittedAt =
        Math.floor(
          Date.now() / 1000
        );

      const hasStartingVariable =
        /^[^\p{L}\p{N}\s]/u.test(
          requestedNickname
        );

      // ========================================================
      // REQUEST EMBED
      // ========================================================

      const requestEmbed =
        new EmbedBuilder()
          .setColor(0x2bafff)
          .setTitle(
            "📝 Nickname Change Request"
          )
          .setThumbnail(
            member.displayAvatarURL({
              extension: "png",
              size: 256
            })
          )
          .addFields(
            {
              name: "👤 User",
              value: `${member}`,
              inline: true
            },
            {
              name: "🆔 Request ID",
              value: requestId,
              inline: true
            },
            {
              name: "🧾 Current Nickname",
              value: oldNickname
            },
            {
              name: "🆕 Requested Nickname",
              value: requestedNickname
            },
            {
              name: "✨ Starting Variable",
              value:
                hasStartingVariable
                  ? "🟡 Present — moderator approval required"
                  : "None",
              inline: true
            },
            {
              name: "📌 Status",
              value:
                "🟡 Pending Review",
              inline: true
            },
            {
              name: "⏱️ Submitted",
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

      let userReply;

      try {

        userReply =
          await message.channel.send({
            embeds: [requestEmbed],
            allowedMentions: {
              users: []
            }
          });

      } catch (error) {

        console.error(
          "❌ Could not send request response:",
          error.message ||
          error
        );

        return;
      }

      // ========================================================
      // CHECK LOG CHANNEL
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
              .setColor(0xffb84d)
              .setTitle(
                "⚠️ Nickname System Not Configured"
              )
              .setDescription(
                "The nickname moderator/log channel has not been configured by the server administrator."
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
      // APPROVER ROLE MENTIONS
      // ========================================================

      const roleMentions =
        config.approverRoleIds.length
          ? config.approverRoleIds
              .map(
                id =>
                  `<@&${id}>`
              )
              .join(" ")
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
              .setColor(0xff4e4e)
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
      // SAVE PENDING REQUEST
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

          // Exact nickname requested.
          // No normalization.
          finalNickname,

          userMessage:
            userReply,

          moderatorMessage:
            moderatorMessage,

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
              .setColor(0x808080)
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

          if (
            request.moderatorMessage
          ) {
            await request.moderatorMessage
              .edit({
                content:
                  "⌛ Request expired.",
                embeds: [
                  expiredEmbed
                ],
                components: []
              })
              .catch(
                () => {}
              );
          }

          if (
            request.userMessage
          ) {
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
          }

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
// AUTOMATIC NICKNAME PROTECTION
// ============================================================
//
// Manual nickname:
//
// 🔥Shakin
//
// becomes:
//
// Shakin
//
// But bot-approved:
//
// 🔥Shakin
//
// remains:
//
// 🔥Shakin
// ============================================================

client.on(
  "guildMemberUpdate",
  async (
    oldMember,
    newMember
  ) => {

    try {

      if (
        newMember.user.bot
      ) {
        return;
      }

      // Only nickname change
      if (
        oldMember.nickname ===
        newMember.nickname
      ) {
        return;
      }

      // --------------------------------------------------------
      // Bot-authorized change
      // --------------------------------------------------------

      if (
        consumeBotNicknameChange(
          newMember.guild.id,
          newMember.id,
          newMember.nickname
        )
      ) {

        console.log(
          `✅ Authorized bot nickname accepted: ${newMember.user.tag} -> ${newMember.nickname}`
        );

        return;
      }

      // --------------------------------------------------------
      // Nickname removed
      // --------------------------------------------------------

      if (
        !newMember.nickname
      ) {
        return;
      }

      // --------------------------------------------------------
      // Clean manual nickname
      // --------------------------------------------------------

      const cleanNickname =
        removeStartingVariables(
          newMember.nickname
        );

      if (
        cleanNickname ===
        newMember.nickname
      ) {
        return;
      }

      if (!cleanNickname) {
        return;
      }

      const permission =
        canBotManageMember(
          newMember.guild,
          newMember
        );

      if (!permission.ok) {
        console.log(
          `⚠️ Cannot auto-clean ${newMember.user.tag}: ${permission.reason}`
        );

        return;
      }

      const oldNickname =
        newMember.nickname;

      markBotNicknameChange(
        newMember.guild.id,
        newMember.id,
        cleanNickname
      );

      try {

        await newMember.setNickname(
          cleanNickname,
          "Removed unauthorized starting variables"
        );

      } catch (error) {

        removeBotNicknameMarker(
          newMember.guild.id,
          newMember.id
        );

        throw error;
      }

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
// NEW MEMBER
// ============================================================

client.on(
  "guildMemberAdd",
  async member => {

    try {

      if (
        member.user.bot
      ) {
        return;
      }

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            1500
          )
      );

      await cleanMemberDisplay(
        member.guild,
        member,
        "New member nickname protection"
      );

    } catch (error) {

      console.error(
        "❌ New member protection error:",
        error.message ||
        error
      );
    }
  }
);

// ============================================================
// GLOBAL NAME UPDATE
// ============================================================
//
// If user changes Discord global/display name to:
//
// 🔥Shakin
//
// and they do not have a server nickname,
// the bot creates:
//
// Shakin
//
// as their server nickname.
// ============================================================

client.on(
  "userUpdate",
  async (
    oldUser,
    newUser
  ) => {

    try {

      if (
        newUser.bot
      ) {
        return;
      }

      const oldName =
        oldUser.globalName ||
        oldUser.username ||
        "";

      const newName =
        newUser.globalName ||
        newUser.username ||
        "";

      if (
        oldName ===
        newName
      ) {
        return;
      }

      const cleanName =
        removeStartingVariables(
          newName
        );

      if (
        !cleanName ||
        cleanName ===
          newName
      ) {
        return;
      }

      // Only process guilds where user has no server nickname.
      for (
        const guild of client.guilds.cache.values()
      ) {

        const member =
          guild.members.cache.get(
            newUser.id
          );

        if (!member) {
          continue;
        }

        if (
          member.nickname
        ) {
          continue;
        }

        await cleanMemberDisplay(
          guild,
          member,
          "Global/display name starting-variable protection"
        );

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              250
            )
        );
      }

    } catch (error) {

      console.error(
        "❌ Global name protection error:",
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

    res.status(200).send(
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

    res.status(200).json({
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
    shutdown("SIGINT")
);

process.on(
  "SIGTERM",
  () =>
    shutdown("SIGTERM")
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
