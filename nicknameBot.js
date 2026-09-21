// ============================================================
// PUBLIC MULTI-SERVER DISCORD NICKNAME MANAGEMENT BOT
// discord.js v14
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
  ChannelType
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
  console.error("❌ DISCORD_TOKEN is missing in .env");
  process.exit(1);
}

// ============================================================
// DATA DIRECTORY
// ============================================================

const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CONFIG_FILE = path.join(DATA_DIR, "guildConfigs.json");
const HISTORY_FILE = path.join(DATA_DIR, "nickHistory.json");

// ============================================================
// LOAD JSON SAFELY
// ============================================================

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`❌ Failed to load ${file}:`, error);
    return fallback;
  }
}

let guildConfigs = loadJSON(CONFIG_FILE, {});
let nickHistory = loadJSON(HISTORY_FILE, {});

// ============================================================
// SAVE DATA
// ============================================================

function saveConfigs() {
  try {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(guildConfigs, null, 2)
    );
  } catch (error) {
    console.error("❌ Failed to save guild configs:", error);
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(
      HISTORY_FILE,
      JSON.stringify(nickHistory, null, 2)
    );
  } catch (error) {
    console.error("❌ Failed to save nickname history:", error);
  }
}

// ============================================================
// DEFAULT SERVER CONFIG
// ============================================================

function getGuildConfig(guildId) {
  if (!guildConfigs[guildId]) {
    guildConfigs[guildId] = {
      requestChannelId: null,
      logChannelId: null,

      // Roles that can approve/reject nickname requests
      approverRoleIds: [],

      // Roles that are allowed to use variables/special
      // characters at the START of their nickname
      variableAllowedRoleIds: [],

      // If false, nickname variable protection is disabled
      variableProtection: true
    };

    saveConfigs();
  }

  return guildConfigs[guildId];
}

// ============================================================
// HELPERS
// ============================================================

function isAdmin(member) {
  return member.permissions.has(
    PermissionsBitField.Flags.Administrator
  );
}

function hasAnyRole(member, roleIds = []) {
  return roleIds.some(roleId =>
    member.roles.cache.has(roleId)
  );
}

function canApprove(member, config) {
  return (
    isAdmin(member) ||
    hasAnyRole(member, config.approverRoleIds)
  );
}

function canUseStartingVariable(member, config) {
  return (
    isAdmin(member) ||
    hasAnyRole(member, config.variableAllowedRoleIds)
  );
}

// ============================================================
// VARIABLE / SPECIAL CHARACTER HANDLER
// ============================================================
//
// "Variable" is treated as anything that is NOT a Unicode
// letter, number or normal whitespace at the beginning.
//
// Examples:
//
// ★ Shakin        -> Shakin
// 『Shakin        -> Shakin
// 🔥 Shakin       -> Shakin
// • Shakin        -> Shakin
//
// But:
//
// Shakin ★        -> unchanged
// Sha★kin         -> unchanged
//
// Members with allowed roles can keep starting variables.
// ============================================================

function removeStartingVariables(nickname) {
  if (!nickname) return nickname;

  let result = nickname.trim();

  // Remove special characters / emoji / symbols
  // only from the START.
  //
  // Unicode letters and numbers are preserved.
  result = result.replace(
    /^[^\p{L}\p{N}\s]+/gu,
    ""
  );

  // Remove spaces left after the variable
  result = result.trim();

  return result;
}

// ============================================================
// NORMALIZE NICKNAME
// ============================================================

function normalizeNickname(member, nickname, config) {
  let result = nickname.trim();

  if (
    config.variableProtection &&
    !canUseStartingVariable(member, config)
  ) {
    result = removeStartingVariables(result);
  }

  return result.trim();
}

// ============================================================
// NICKNAME VALIDATION
// ============================================================

function validateNickname(nickname) {
  if (!nickname) {
    return "❌ Nickname cannot be empty.";
  }

  if (nickname.length > 32) {
    return "❌ Nickname cannot be longer than **32 characters**.";
  }

  return null;
}

// ============================================================
// REQUEST STORAGE
// ============================================================
//
// Active requests stay in memory.
// Once approved/rejected, they are removed.
// ============================================================

const pendingRequests = new Map();

// requestId -> {
//   guildId,
//   userId,
//   oldNickname,
//   requestedNickname,
//   finalNickname,
//   userMessageId,
//   moderatorMessageId,
//   status
// }

// ============================================================
// REQUEST ID
// ============================================================

function createRequestId() {
  return (
    "REQ-" +
    Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase()
  );
}

// ============================================================
// EMBED FOOTER
// ============================================================

function footer() {
  return {
    text: "Nickname Management System"
  };
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [

  // ----------------------------------------------------------
  // /nicksetup
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("nicksetup")
    .setDescription("Configure the nickname system for this server.")
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.Administrator.toString()
    )
    .addSubcommand(sub =>
      sub
        .setName("request-channel")
        .setDescription("Set the nickname request channel.")
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Nickname request channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("log-channel")
        .setDescription("Set the moderator/log channel.")
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Log channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("approver-add")
        .setDescription("Allow a role to approve/reject requests.")
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Approver role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("approver-remove")
        .setDescription("Remove a role from nickname approvers.")
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("variable-role-add")
        .setDescription(
          "Allow a role to use variables/symbols at the start of nicknames."
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Allowed role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("variable-role-remove")
        .setDescription(
          "Remove a role from variable-allowed roles."
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("variable-protection")
        .setDescription("Enable or disable variable protection.")
        .addBooleanOption(option =>
          option
            .setName("enabled")
            .setDescription("Enable variable protection?")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("show")
        .setDescription("Show current nickname configuration.")
    ),

  // ----------------------------------------------------------
  // /nickpanel
  // ----------------------------------------------------------

  new SlashCommandBuilder()
    .setName("nickpanel")
    .setDescription("Send the nickname request panel.")
    .setDefaultMemberPermissions(
      PermissionsBitField.Flags.Administrator.toString()
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel where the panel should be sent.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
].map(command => command.toJSON());

// ============================================================
// REGISTER SLASH COMMANDS GLOBALLY
// ============================================================

async function registerCommands() {
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      {
        body: commands
      }
    );

    console.log("✅ Global slash commands registered.");
  } catch (error) {
    console.error(
      "❌ Failed to register slash commands:",
      error
    );
  }
}

// ============================================================
// READY
// ============================================================

client.once("ready", async () => {

  console.log("=================================");
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🌐 Servers: ${client.guilds.cache.size}`);
  console.log("=================================");

  client.user.setPresence({
    activities: [
      {
        name: "Nickname Management",
        type: ActivityType.Watching
      }
    ],
    status: "online"
  });

  await registerCommands();
});

// ============================================================
// SLASH COMMAND HANDLER
// ============================================================

client.on("interactionCreate", async interaction => {

  // ==========================================================
  // SLASH COMMANDS
  // ==========================================================

  if (interaction.isChatInputCommand()) {

    if (!interaction.guild) {
      return interaction.reply({
        content:
          "❌ This command can only be used inside a server.",
        ephemeral: true
      });
    }

    const guild = interaction.guild;
    const member = interaction.member;

    if (!isAdmin(member)) {
      return interaction.reply({
        content:
          "❌ Only server administrators can configure this bot.",
        ephemeral: true
      });
    }

    const config = getGuildConfig(guild.id);

    // --------------------------------------------------------
    // /nicksetup
    // --------------------------------------------------------

    if (interaction.commandName === "nicksetup") {

      const sub = interaction.options.getSubcommand();

      // ------------------------------------------------------
      // REQUEST CHANNEL
      // ------------------------------------------------------

      if (sub === "request-channel") {

        const channel =
          interaction.options.getChannel("channel");

        config.requestChannelId = channel.id;

        saveConfigs();

        return interaction.reply({
          content:
            `✅ Nickname request channel set to ${channel}.`,
          ephemeral: true
        });
      }

      // ------------------------------------------------------
      // LOG CHANNEL
      // ------------------------------------------------------

      if (sub === "log-channel") {

        const channel =
          interaction.options.getChannel("channel");

        config.logChannelId = channel.id;

        saveConfigs();

        return interaction.reply({
          content:
            `✅ Nickname log channel set to ${channel}.`,
          ephemeral: true
        });
      }

      // ------------------------------------------------------
      // APPROVER ADD
      // ------------------------------------------------------

      if (sub === "approver-add") {

        const role =
          interaction.options.getRole("role");

        if (!config.approverRoleIds.includes(role.id)) {
          config.approverRoleIds.push(role.id);
        }

        saveConfigs();

        return interaction.reply({
          content:
            `✅ ${role} can now approve/reject nickname requests.`,
          ephemeral: true
        });
      }

      // ------------------------------------------------------
      // APPROVER REMOVE
      // ------------------------------------------------------

      if (sub === "approver-remove") {

        const role =
          interaction.options.getRole("role");

        config.approverRoleIds =
          config.approverRoleIds.filter(
            id => id !== role.id
          );

        saveConfigs();

        return interaction.reply({
          content:
            `✅ ${role} can no longer approve/reject nickname requests.`,
          ephemeral: true
        });
      }

      // ------------------------------------------------------
      // VARIABLE ROLE ADD
      // ------------------------------------------------------

      if (sub === "variable-role-add") {

        const role =
          interaction.options.getRole("role");

        if (!config.variableAllowedRoleIds.includes(role.id)) {
          config.variableAllowedRoleIds.push(role.id);
        }

        saveConfigs();

        return interaction.reply({
          content:
            `✅ ${role} can now use variables/symbols at the START of their nickname.`,
          ephemeral: true
        });
      }

      // ------------------------------------------------------
      // VARIABLE ROLE REMOVE
      // ------------------------------------------------------

      if (sub === "variable-role-remove") {

        const role =
          interaction.options.getRole("role");

        config.variableAllowedRoleIds =
          config.variableAllowedRoleIds.filter(
            id => id !== role.id
          );

        saveConfigs();

        return interaction.reply({
          content:
            `✅ ${role} is no longer allowed to use starting variables.`,
          ephemeral: true
        });
      }

      // ------------------------------------------------------
      // VARIABLE PROTECTION
      // ------------------------------------------------------

      if (sub === "variable-protection") {

        const enabled =
          interaction.options.getBoolean("enabled");

        config.variableProtection = enabled;

        saveConfigs();

        return interaction.reply({
          content:
            enabled
              ? "✅ Variable protection is now **ON**."
              : "⚠️ Variable protection is now **OFF**.",
          ephemeral: true
        });
      }

      // ------------------------------------------------------
      // SHOW CONFIG
      // ------------------------------------------------------

      if (sub === "show") {

        const approvers =
          config.approverRoleIds.length
            ? config.approverRoleIds
                .map(id => `<@&${id}>`)
                .join(", ")
            : "Not configured";

        const variableRoles =
          config.variableAllowedRoleIds.length
            ? config.variableAllowedRoleIds
                .map(id => `<@&${id}>`)
                .join(", ")
            : "No roles configured";

        const embed = new EmbedBuilder()
          .setColor(0x2bafff)
          .setTitle("⚙️ Nickname System Configuration")
          .addFields(
            {
              name: "📝 Request Channel",
              value:
                config.requestChannelId
                  ? `<#${config.requestChannelId}>`
                  : "Not configured",
              inline: false
            },
            {
              name: "📋 Log Channel",
              value:
                config.logChannelId
                  ? `<#${config.logChannelId}>`
                  : "Not configured",
              inline: false
            },
            {
              name: "👮 Approver Roles",
              value: approvers,
              inline: false
            },
            {
              name: "✨ Variable Allowed Roles",
              value: variableRoles,
              inline: false
            },
            {
              name: "🛡️ Variable Protection",
              value:
                config.variableProtection
                  ? "🟢 Enabled"
                  : "🔴 Disabled",
              inline: false
            }
          )
          .setFooter(footer())
          .setTimestamp();

        return interaction.reply({
          embeds: [embed],
          ephemeral: true
        });
      }
    }

    // --------------------------------------------------------
    // NICKPANEL
    // --------------------------------------------------------

    if (interaction.commandName === "nickpanel") {

      const selectedChannel =
        interaction.options.getChannel("channel");

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

      const embed = new EmbedBuilder()
        .setColor(0x2bafff)
        .setTitle("📝 Nickname Change")
        .setDescription(
          [
            "Send your requested nickname in this channel.",
            "",
            "You **do not need any command or prefix**.",
            "",
            "Example:",
            "`Shakin Ahmed`",
            "",
            "Your request will be sent to the configured moderators for approval.",
            "",
            "⚠️ Members without the configured Variable Allowed Role cannot use special characters / emojis at the **beginning** of their nickname."
          ].join("\n")
        )
        .setFooter(footer())
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
  }

  // ==========================================================
  // BUTTONS
  // ==========================================================

  if (interaction.isButton()) {

    const customId = interaction.customId;

    if (
      !customId.startsWith("nick_accept_") &&
      !customId.startsWith("nick_reject_")
    ) {
      return;
    }

    const requestId =
      customId
        .replace("nick_accept_", "")
        .replace("nick_reject_", "");

    const request =
      pendingRequests.get(requestId);

    if (!request) {

      return interaction.reply({
        content:
          "⚠️ This nickname request is no longer active.",
        ephemeral: true
      });
    }

    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({
        content:
          "❌ This request is no longer associated with a server.",
        ephemeral: true
      });
    }

    const config =
      getGuildConfig(guild.id);

    const moderator =
      await guild.members
        .fetch(interaction.user.id)
        .catch(() => null);

    if (!moderator) {
      return interaction.reply({
        content:
          "❌ Could not find your server membership.",
        ephemeral: true
      });
    }

    if (!canApprove(moderator, config)) {

      return interaction.reply({
        content:
          "❌ You do not have permission to approve or reject nickname requests.",
        ephemeral: true
      });
    }

    // --------------------------------------------------------
    // PREVENT DOUBLE PROCESSING
    // --------------------------------------------------------

    if (request.status !== "pending") {

      return interaction.reply({
        content:
          "⚠️ This request has already been processed.",
        ephemeral: true
      });
    }

    request.status = "processing";

    await interaction.deferUpdate();

    const member =
      await guild.members
        .fetch(request.userId)
        .catch(() => null);

    if (!member) {

      request.status = "failed";

      pendingRequests.delete(requestId);

      return interaction.message.edit({
        content:
          "❌ Member is no longer in this server.",
        components: []
      });
    }

    // ========================================================
    // APPROVE
    // ========================================================

    if (customId.startsWith("nick_accept_")) {

      try {

        // Re-check nickname hierarchy
        const botMember =
          guild.members.me;

        if (!botMember) {
          throw new Error("Bot member unavailable");
        }

        if (
          member.roles.highest.position >=
          botMember.roles.highest.position
        ) {

          request.status = "failed";

          return interaction.message.edit({
            content:
              "❌ Cannot change nickname because the member's highest role is equal to or higher than the bot's highest role.",
            components: []
          });
        }

        // Save old nickname
        nickHistory[member.id] = {
          guildId: guild.id,
          nickname:
            member.nickname ||
            member.user.username,
          savedAt: Date.now()
        };

        saveHistory();

        await member.setNickname(
          request.finalNickname,
          `Nickname request ${requestId} approved by ${interaction.user.tag}`
        );

        request.status = "approved";

        const embed = new EmbedBuilder()
          .setColor(0x4dff88)
          .setTitle("✅ Nickname Request Approved")
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
                member.user.username,
              inline: false
            },
            {
              name: "🆕 New Nickname",
              value: request.finalNickname,
              inline: false
            },
            {
              name: "📌 Status",
              value: "🟢 Approved",
              inline: false
            }
          )
          .setFooter(footer())
          .setTimestamp();

        await interaction.message.edit({
          content: "✅ Request approved.",
          embeds: [embed],
          components: []
        });

        // Edit user's original response
        const requestChannel =
          guild.channels.cache.get(
            config.requestChannelId
          );

        if (requestChannel) {

          const userMessage =
            await requestChannel.messages
              .fetch(request.userMessageId)
              .catch(() => null);

          if (userMessage) {
            await userMessage.edit({
              embeds: [embed],
              components: []
            }).catch(() => {});
          }
        }

        // DM user
        await member.send({
          embeds: [embed]
        }).catch(() => {});

        // Log
        await sendLog(
          guild,
          config,
          embed
        );

        pendingRequests.delete(requestId);

      } catch (error) {

        console.error(
          "❌ Approve error:",
          error
        );

        request.status = "failed";

        const errorEmbed = new EmbedBuilder()
          .setColor(0xff4e4e)
          .setTitle("❌ Nickname Change Failed")
          .setDescription(
            "The nickname could not be changed. Please check the bot's role hierarchy and permissions."
          )
          .setFooter(footer())
          .setTimestamp();

        await interaction.message.edit({
          content:
            "❌ Nickname change failed.",
          embeds: [errorEmbed],
          components: []
        });
      }

      return;
    }

    // ========================================================
    // REJECT
    // ========================================================

    if (customId.startsWith("nick_reject_")) {

      request.status = "rejected";

      const embed = new EmbedBuilder()
        .setColor(0xff4e4e)
        .setTitle("❌ Nickname Request Rejected")
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
              member.user.username,
            inline: false
          },
          {
            name: "🆕 Requested Nickname",
            value: request.requestedNickname,
            inline: false
          },
          {
            name: "📌 Status",
            value: "🔴 Rejected",
            inline: false
          }
        )
        .setFooter(footer())
        .setTimestamp();

      await interaction.message.edit({
        content: "❌ Request rejected.",
        embeds: [embed],
        components: []
      });

      const requestChannel =
        guild.channels.cache.get(
          config.requestChannelId
        );

      if (requestChannel) {

        const userMessage =
          await requestChannel.messages
            .fetch(request.userMessageId)
            .catch(() => null);

        if (userMessage) {

          await userMessage.edit({
            embeds: [embed],
            components: []
          }).catch(() => {});
        }
      }

      await member.send({
        embeds: [embed]
      }).catch(() => {});

      await sendLog(
        guild,
        config,
        embed
      );

      pendingRequests.delete(requestId);

      return;
    }
  }
});

// ============================================================
// MESSAGE CREATE
// ============================================================
//
// In the configured request channel:
//
// Member simply writes:
//
// Shakin Ahmed
//
// No command required.
// ============================================================

client.on("messageCreate", async message => {

  if (!message.guild) return;

  if (message.author.bot) return;

  const guild = message.guild;
  const config = getGuildConfig(guild.id);

  // Only process configured request channel
  if (
    !config.requestChannelId ||
    message.channel.id !== config.requestChannelId
  ) {
    return;
  }

  const member =
    await guild.members
      .fetch(message.author.id)
      .catch(() => null);

  if (!member) return;

  let requestedNickname =
    message.content.trim();

  if (!requestedNickname) return;

  // ==========================================================
  // NORMALIZE NICKNAME
  // ==========================================================

  const finalNickname =
    normalizeNickname(
      member,
      requestedNickname,
      config
    );

  // If user has no variable permission and
  // all starting characters were variables
  if (!finalNickname) {

    await message.reply({
      content:
        "❌ Your nickname must contain at least one letter or number."
    }).catch(() => {});

    return;
  }

  // ==========================================================
  // VALIDATE
  // ==========================================================

  const validationError =
    validateNickname(finalNickname);

  if (validationError) {

    await message.reply({
      content: validationError
    }).catch(() => {});

    return;
  }

  // ==========================================================
  // CHECK BOT ROLE HIERARCHY
  // ==========================================================

  const botMember =
    guild.members.me;

  if (!botMember) return;

  if (
    member.roles.highest.position >=
    botMember.roles.highest.position
  ) {

    await message.reply({
      content:
        "❌ I cannot change your nickname because your highest role is equal to or higher than my highest role."
    }).catch(() => {});

    return;
  }

  // ==========================================================
  // CREATE REQUEST
  // ==========================================================

  const requestId =
    createRequestId();

  const oldNickname =
    member.nickname ||
    member.user.username;

  const variableRemoved =
    requestedNickname !== finalNickname;

  const submittedAt =
    Math.floor(Date.now() / 1000);

  const requestEmbed =
    new EmbedBuilder()
      .setColor(0x2bafff)
      .setTitle("📝 Nickname Change Request")
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
          value: oldNickname,
          inline: false
        },
        {
          name: "🆕 Requested Nickname",
          value: requestedNickname,
          inline: false
        },
        {
          name: "✅ Final Nickname",
          value: finalNickname,
          inline: false
        },
        {
          name: "✨ Starting Variable",
          value:
            variableRemoved
              ? "⚠️ Removed automatically"
              : "None",
          inline: true
        },
        {
          name: "📌 Status",
          value: "🟡 Pending Review",
          inline: true
        },
        {
          name: "⏱️ Submitted",
          value: `<t:${submittedAt}:F>`,
          inline: false
        }
      )
      .setFooter({
        text:
          "Waiting for an authorized moderator to approve or reject."
      })
      .setTimestamp();

  // ==========================================================
  // USER MESSAGE
  // ==========================================================

  const userReply =
    await message.reply({
      embeds: [requestEmbed],
      allowedMentions: {
        users: []
      }
    });

  // ==========================================================
  // BUTTONS
  // ==========================================================

  const buttons =
    new ActionRowBuilder().addComponents(

      new ButtonBuilder()
        .setCustomId(
          `nick_accept_${requestId}`
        )
        .setLabel("Approve")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(
          `nick_reject_${requestId}`
        )
        .setLabel("Reject")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger)
    );

  // ==========================================================
  // LOG CHANNEL
  // ==========================================================

  const logChannel =
    config.logChannelId
      ? guild.channels.cache.get(
          config.logChannelId
        )
      : null;

  if (!logChannel) {

    await userReply.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(0xffb84d)
          .setTitle("⚠️ Nickname System Not Configured")
          .setDescription(
            "The nickname log channel has not been configured by the server administrator."
          )
          .setFooter(footer())
          .setTimestamp()
      ]
    }).catch(() => {});

    return;
  }

  // ==========================================================
  // APPROVER ROLE MENTIONS
  // ==========================================================

  const roleMentions =
    config.approverRoleIds.length
      ? config.approverRoleIds
          .map(id => `<@&${id}>`)
          .join(" ")
      : "";

  // ==========================================================
  // SEND MODERATOR REQUEST
  // ==========================================================

  const moderatorMessage =
    await logChannel.send({
      content:
        roleMentions
          ? `${roleMentions}\n🔔 **New nickname change request.**`
          : "🔔 **New nickname change request.**",

      embeds: [requestEmbed],

      components: [buttons],

      allowedMentions: {
        roles: config.approverRoleIds
      }
    });

  // ==========================================================
  // SAVE PENDING REQUEST
  // ==========================================================

  pendingRequests.set(requestId, {

    guildId: guild.id,

    userId: member.id,

    oldNickname,

    requestedNickname,

    finalNickname,

    userMessageId:
      userReply.id,

    moderatorMessageId:
      moderatorMessage.id,

    status: "pending",

    createdAt: Date.now()
  });

  // ==========================================================
  // AUTO EXPIRE AFTER 3 HOURS
  // ==========================================================

  setTimeout(async () => {

    const request =
      pendingRequests.get(requestId);

    if (!request) return;

    if (request.status !== "pending") {
      return;
    }

    request.status = "expired";

    pendingRequests.delete(requestId);

    const expiredEmbed =
      new EmbedBuilder()
        .setColor(0x808080)
        .setTitle("⌛ Nickname Request Expired")
        .setDescription(
          "This nickname request was not processed within the allowed time."
        )
        .addFields({
          name: "🆔 Request ID",
          value: requestId
        })
        .setFooter(footer())
        .setTimestamp();

    await moderatorMessage.edit({
      content:
        "⌛ Request expired.",
      embeds: [expiredEmbed],
      components: []
    }).catch(() => {});

    await userReply.edit({
      embeds: [expiredEmbed],
      components: []
    }).catch(() => {});

  }, 3 * 60 * 60 * 1000);
});

// ============================================================
// AUTO REMOVE STARTING VARIABLES
// ============================================================
//
// This protects nicknames even if a member manually changes
// their nickname without using the request system.
//
// Runs whenever a member updates.
// ============================================================

client.on("guildMemberUpdate", async (oldMember, newMember) => {

  try {

    const config =
      getGuildConfig(newMember.guild.id);

    if (!config.variableProtection) {
      return;
    }

    if (!newMember.nickname) {
      return;
    }

    // Allowed role members can use variables
    if (
      canUseStartingVariable(
        newMember,
        config
      )
    ) {
      return;
    }

    const cleanNickname =
      removeStartingVariables(
        newMember.nickname
      );

    if (!cleanNickname) {
      return;
    }

    if (
      cleanNickname ===
      newMember.nickname
    ) {
      return;
    }

    const botMember =
      newMember.guild.members.me;

    if (!botMember) return;

    if (
      newMember.roles.highest.position >=
      botMember.roles.highest.position
    ) {
      return;
    }

    await newMember.setNickname(
      cleanNickname,
      "Removed unauthorized starting variables from nickname"
    );

    console.log(
      `🧹 Removed starting variable from ${newMember.user.tag} in ${newMember.guild.name}`
    );

    // Log automatic removal
    await sendAutoRemoveLog(
      newMember.guild,
      config,
      newMember,
      cleanNickname
    );

  } catch (error) {

    console.error(
      "❌ Auto nickname protection error:",
      error
    );
  }
});

// ============================================================
// LOG FUNCTION
// ============================================================

async function sendLog(
  guild,
  config,
  embed
) {

  try {

    if (!config.logChannelId) return;

    const channel =
      guild.channels.cache.get(
        config.logChannelId
      );

    if (!channel) return;

    await channel.send({
      embeds: [embed]
    });

  } catch (error) {

    console.error(
      "❌ Failed to send log:",
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
  cleanNickname
) {

  try {

    if (!config.logChannelId) return;

    const channel =
      guild.channels.cache.get(
        config.logChannelId
      );

    if (!channel) return;

    const embed =
      new EmbedBuilder()
        .setColor(0xffb84d)
        .setTitle("🧹 Unauthorized Starting Variable Removed")
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
            name: "🧾 New Nickname",
            value: cleanNickname,
            inline: true
          },
          {
            name: "📌 Action",
            value:
              "Starting variable automatically removed.",
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
      error
    );
  }
}

// ============================================================
// GUILD JOIN
// ============================================================

client.on("guildCreate", guild => {

  getGuildConfig(guild.id);

  console.log(
    `➕ Joined server: ${guild.name} (${guild.id})`
  );
});

// ============================================================
// GUILD DELETE
// ============================================================

client.on("guildDelete", guild => {

  // Delete this server's configuration so the bot
  // does not keep unnecessary server-specific data.

  if (guildConfigs[guild.id]) {

    delete guildConfigs[guild.id];

    saveConfigs();
  }

  console.log(
    `➖ Removed server configuration: ${guild.name}`
  );
});

// ============================================================
// EXPRESS KEEP-ALIVE
// ============================================================

const app = express();

app.get("/", (req, res) => {

  res.status(200).send(
    "Nickname Management Bot is online ✅"
  );
});

app.get("/health", (req, res) => {

  res.status(200).json({
    status: "online",
    bot: client.user
      ? client.user.tag
      : "starting",
    servers: client.guilds.cache.size,
    uptime: process.uptime()
  });
});

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `🌐 Web server running on port ${PORT}`
  );
});

// ============================================================
// ERROR HANDLERS
// ============================================================

process.on("unhandledRejection", error => {

  console.error(
    "❌ Unhandled Promise Rejection:",
    error
  );
});

process.on("uncaughtException", error => {

  console.error(
    "❌ Uncaught Exception:",
    error
  );
});

// ============================================================
// SAVE DATA BEFORE EXIT
// ============================================================

function shutdown(signal) {

  console.log(
    `\n🛑 ${signal} received. Saving data...`
  );

  saveConfigs();
  saveHistory();

  client.destroy();

  process.exit(0);
}

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

// ============================================================
// LOGIN
// ============================================================

client.login(TOKEN);
