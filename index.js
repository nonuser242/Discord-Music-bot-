const fs = require("node:fs");
const path = require("node:path");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActivityType,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
} = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");


// =====================================================
// CONFIG
// =====================================================

const TOKEN = process.env.TOKEN;

const CLIENT_ID = "1543273003822092469";

const SUPPORT_SERVER = "https://discord.gg/JNrsrm8kn";

const CUSTOM_EMOJI = "<a:Scubbacat:1542552078382272532>";

const DATA_FILE = path.join(__dirname, "voice_channels.json");


// =====================================================
// CHECK TOKEN
// =====================================================

if (!TOKEN) {
  console.error("ERROR: TOKEN is missing.");
  process.exit(1);
}


// =====================================================
// DISCORD CLIENT
// =====================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});


// =====================================================
// SAVE / LOAD VOICE CHANNELS
// =====================================================

function loadVoiceChannels() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {};
    }

    const data = fs.readFileSync(DATA_FILE, "utf8");

    return JSON.parse(data);
  } catch (error) {
    console.error("Could not load voice channels:", error);
    return {};
  }
}


function saveVoiceChannels(data) {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Could not save voice channels:", error);
  }
}


let savedChannels = loadVoiceChannels();


// =====================================================
// SLASH COMMANDS
// =====================================================

const commands = [

  new SlashCommandBuilder()
    .setName("connect")
    .setDescription("Connect the bot to your voice channel"),

  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Disconnect the bot from the voice channel"),

  new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Get the bot invite link"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Learn how to use the bot"),

].map(command => command.toJSON());


// =====================================================
// REGISTER COMMANDS
// =====================================================

async function registerCommands() {
  const rest = new REST({
    version: "10",
  }).setToken(TOKEN);

  try {
    console.log("| Loading slash commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      {
        body: commands,
      }
    );

    console.log("| Slash Commands Loaded!");

  } catch (error) {
    console.error("Slash command error:", error);
  }
}


// =====================================================
// BOT STATUS
// =====================================================

// Foreign / international songs only
const songs = [
  "Cris MJ",
  "The Weeknd",
  "Drake",
  "DJ Khaled",
  "Bad Bunny",
  "Travis Scott",
  "Billie Eilish",
  "Post Malone",
];

let songIndex = 0;


function updateStatus() {

  const song = songs[songIndex];

  client.user.setPresence({
    status: "dnd",

    activities: [
      {
        name: `${CUSTOM_EMOJI} ${song}`,
        type: ActivityType.Listening,
      },
    ],
  });

  console.log(`Listening status: ${song}`);

  songIndex = (songIndex + 1) % songs.length;
}


// =====================================================
// CONNECT TO VOICE CHANNEL
// =====================================================

async function connectToChannel(channel) {

  if (!channel) {
    throw new Error("Voice channel not found.");
  }

  if (!channel.joinable) {
    throw new Error(
      "I do not have permission to join this voice channel."
    );
  }

  const oldConnection = getVoiceConnection(
    channel.guild.id
  );

  if (oldConnection) {
    try {
      oldConnection.destroy();
    } catch (error) {
      console.error("Old connection error:", error);
    }
  }

  const connection = joinVoiceChannel({

    channelId: channel.id,

    guildId: channel.guild.id,

    adapterCreator:
      channel.guild.voiceAdapterCreator,

    selfDeaf: true,

    selfMute: false,

  });

  connection.on(
    VoiceConnectionStatus.Disconnected,
    async () => {

      console.log(
        `Disconnected from ${channel.guild.name}. Trying to reconnect...`
      );

      try {

        await Promise.race([
          entersState(
            connection,
            VoiceConnectionStatus.Signalling,
            5000
          ),

          entersState(
            connection,
            VoiceConnectionStatus.Connecting,
            5000
          ),
        ]);

      } catch (error) {

        try {

          console.log(
            `Reconnecting to ${channel.guild.name}...`
          );

          connection.rejoin();

        } catch (rejoinError) {

          console.error(
            "Reconnection failed:",
            rejoinError
          );

        }

      }

    }
  );


  connection.on(
    VoiceConnectionStatus.Destroyed,
    () => {

      console.log(
        `Voice connection destroyed in ${channel.guild.name}`
      );

    }
  );


  try {

    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      30000
    );

    console.log(
      `Connected to voice channel: ${channel.name}`
    );

    return connection;

  } catch (error) {

    connection.destroy();

    throw error;
  }

}


// =====================================================
// AUTO RECONNECT AFTER BOT RESTART
// =====================================================

async function restoreVoiceChannels() {

  console.log(
    `Restoring ${Object.keys(savedChannels).length} voice channel(s)...`
  );

  for (const guildId of Object.keys(savedChannels)) {

    const channelId = savedChannels[guildId];

    try {

      const channel =
        await client.channels.fetch(channelId);

      if (!channel) {
        continue;
      }

      if (!channel.isVoiceBased()) {
        continue;
      }

      await connectToChannel(channel);

      console.log(
        `Restored connection: ${channel.guild.name} -> ${channel.name}`
      );

    } catch (error) {

      console.error(
        `Could not restore voice channel ${channelId}:`,
        error.message
      );

    }

  }

}


// =====================================================
// READY
// =====================================================

client.once("clientReady", async () => {

  console.log(
    `Bot Online: ${client.user.tag}`
  );

  // Register slash commands
  await registerCommands();

  // Set status immediately
  updateStatus();

  // Change Listening status every 5 minutes
  setInterval(() => {

    updateStatus();

  }, 5 * 60 * 1000);


  // Restore voice channels
  await restoreVoiceChannels();

});


// =====================================================
// SAFE REPLY
// =====================================================

async function replyPrivate(interaction, content) {

  const options = {
    content,
    flags: MessageFlags.Ephemeral,
  };

  if (interaction.replied || interaction.deferred) {

    return interaction.followUp(options);

  }

  return interaction.reply(options);

}


// =====================================================
// INTERACTION HANDLER
// =====================================================

client.on(
  "interactionCreate",
  async interaction => {

    if (!interaction.isChatInputCommand()) {
      return;
    }


    // =================================================
    // CONNECT
    // =================================================

    if (interaction.commandName === "connect") {

      // Must be used inside a server
      if (!interaction.guild) {

        return interaction.reply({
          content:
            "❌ This command can only be used inside a Discord server.",
        });

      }


      // Admin only
      if (
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.Administrator
        )
      ) {

        return replyPrivate(
          interaction,
          "❌ Only server administrators can use this command."
        );

      }


      const voiceChannel =
        interaction.member?.voice?.channel;


      if (!voiceChannel) {

        return replyPrivate(
          interaction,
          "❌ Join a voice channel first, then use `/connect`."
        );

      }


      try {

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral,
        });


        await connectToChannel(
          voiceChannel
        );


        // Save separately for every server
        savedChannels[
          interaction.guild.id
        ] = voiceChannel.id;


        saveVoiceChannels(
          savedChannels
        );


        await interaction.editReply(
          `✅ Connected to **${voiceChannel.name}**.\n\n` +
          `🏁 The bot will automatically return to this voice channel after a restart.`
        );


      } catch (error) {

        console.error(
          "Connect error:",
          error
        );


        if (
          interaction.deferred ||
          interaction.replied
        ) {

          await interaction.editReply(
            `❌ Could not connect to the voice channel.\n\`${error.message}\``
          );

        } else {

          await replyPrivate(
            interaction,
            "❌ Could not connect to the voice channel."
          );

        }

      }

      return;
    }


    // =================================================
    // DISCONNECT
    // =================================================

    if (interaction.commandName === "disconnect") {

      if (!interaction.guild) {

        return interaction.reply({
          content:
            "❌ This command can only be used inside a Discord server.",
        });

      }


      // Admin only
      if (
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.Administrator
        )
      ) {

        return replyPrivate(
          interaction,
          "❌ Only server administrators can use this command."
        );

      }


      try {

        const connection =
          getVoiceConnection(
            interaction.guild.id
          );


        if (connection) {

          connection.destroy();

        }


        // Remove saved voice channel
        delete savedChannels[
          interaction.guild.id
        ];


        saveVoiceChannels(
          savedChannels
        );


        return replyPrivate(
          interaction,
          "👋 Disconnected from the voice channel."
        );


      } catch (error) {

        console.error(
          "Disconnect error:",
          error
        );


        return replyPrivate(
          interaction,
          "❌ Something went wrong while disconnecting."
        );

      }

    }


    // =================================================
    // INVITE
    // =================================================

    if (interaction.commandName === "invite") {

      const inviteURL =
        `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&integration_type=0&scope=bot+applications.commands`;


      const button =
        new ButtonBuilder()
          .setLabel("Invite Bot")
          .setStyle(ButtonStyle.Link)
          .setURL(inviteURL);


      const row =
        new ActionRowBuilder()
          .addComponents(button);


      const embed =
        new EmbedBuilder()

          .setTitle("🤖 Invite the Bot")

          .setDescription(
            "Click the button below to invite the bot to your Discord server."
          )

          .addFields({
            name: "Support Server",
            value: SUPPORT_SERVER,
          });


      return interaction.reply({

        embeds: [embed],

        components: [row],

        flags: interaction.guild
          ? MessageFlags.Ephemeral
          : undefined,

      });

    }


    // =================================================
    // HELP
    // =================================================

    if (interaction.commandName === "help") {

      const supportButton =
        new ButtonBuilder()
          .setLabel("Server Support")
          .setStyle(ButtonStyle.Link)
          .setURL(SUPPORT_SERVER);


      const row =
        new ActionRowBuilder()
          .addComponents(
            supportButton
          );


      const embed =
        new EmbedBuilder()

          .setTitle("🤖 Bot Commands")

          .setDescription(
            "Here is how to use the bot:"
          )

          .addFields(

            {
              name: "/connect",
              value:
                "Connect the bot to your current voice channel. Only server administrators can use this command.",
            },

            {
              name: "/disconnect",
              value:
                "Disconnect the bot from the voice channel. Only server administrators can use this command.",
            },

            {
              name: "/invite",
              value:
                "Get the bot invite link.",
            },

            {
              name: "/help",
              value:
                "Show this help message.",
            }

          )

          .setFooter({
            text:
              "The bot automatically remembers its voice channel after a restart.",
          });


      return interaction.reply({

        embeds: [embed],

        components: [row],

        flags: interaction.guild
          ? MessageFlags.Ephemeral
          : undefined,

      });

    }

  }
);


// =====================================================
// ERROR HANDLERS
// =====================================================

client.on(
  "error",
  error => {

    console.error(
      "Discord client error:",
      error
    );

  }
);


process.on(
  "unhandledRejection",
  error => {

    console.error(
      "Unhandled Promise Rejection:",
      error
    );

  }
);


process.on(
  "uncaughtException",
  error => {

    console.error(
      "Uncaught Exception:",
      error
    );

  }
);


// =====================================================
// LOGIN
// =====================================================

client.login(TOKEN);
