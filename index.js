const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActivityType,
  PresenceUpdateStatus,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');

const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  getVoiceConnection
} = require('@discordjs/voice');

const fs = require('fs');
const path = require('path');


// =====================================
// CONFIG
// =====================================

const TOKEN = process.env.TOKEN;

const CLIENT_ID = '1543273003822092469';

const SUPPORT_SERVER =
  'https://discord.gg/JNrsrm8kn';

const DATA_FILE = path.join(
  __dirname,
  'voice_channels.json'
);


// =====================================
// CHECK TOKEN
// =====================================

if (!TOKEN) {
  console.error(
    '❌ TOKEN environment variable is missing!'
  );

  process.exit(1);
}


// =====================================
// DISCORD CLIENT
// =====================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});


// =====================================
// SAVE VOICE CHANNELS
// =====================================

function loadVoiceChannels() {
  try {

    if (!fs.existsSync(DATA_FILE)) {
      return {};
    }

    const data = fs.readFileSync(
      DATA_FILE,
      'utf8'
    );

    return JSON.parse(data);

  } catch (error) {

    console.error(
      '❌ Could not load voice channels:',
      error
    );

    return {};
  }
}


function saveVoiceChannels(data) {
  try {

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        data,
        null,
        2
      )
    );

  } catch (error) {

    console.error(
      '❌ Could not save voice channels:',
      error
    );
  }
}


let savedVoiceChannels =
  loadVoiceChannels();


// =====================================
// COMMANDS
// =====================================

const commands = [

  new SlashCommandBuilder()
    .setName('connect')
    .setDescription(
      'Connect the bot to your Voice Channel.'
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    ),

  new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription(
      'Disconnect the bot from the Voice Channel.'
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    ),

  new SlashCommandBuilder()
    .setName('invite')
    .setDescription(
      'Get the bot invite link.'
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription(
      'Learn how to use the bot.'

    )

].map(command =>
  command.toJSON()
);


// =====================================
// HELPER FUNCTIONS
// =====================================

function isAdmin(interaction) {

  if (!interaction.inGuild()) {
    return false;
  }

  return interaction.memberPermissions?.has(
    PermissionFlagsBits.Administrator
  );

}


async function adminOnly(interaction) {

  if (isAdmin(interaction)) {
    return true;
  }

  await interaction.reply({
    content:
      '❌ Only server administrators can use this command.',
    flags: MessageFlags.Ephemeral
  });

  return false;
}


async function safeReply(
  interaction,
  options
) {

  try {

    if (
      interaction.replied ||
      interaction.deferred
    ) {

      return await interaction.followUp(
        options
      );

    }

    return await interaction.reply(
      options
    );

  } catch (error) {

    console.error(
      'Reply error:',
      error
    );
  }
}


// =====================================
// CONNECT BOT
// =====================================

async function connectToVoiceChannel(
  guild,
  channelId
) {

  try {

    const channel =
      await client.channels.fetch(
        channelId
      );

    if (!channel) {
      throw new Error(
        'Voice channel not found.'
      );
    }

    const existing =
      getVoiceConnection(
        guild.id
      );

    if (existing) {

      if (
        existing.joinConfig.channelId ===
        channelId
      ) {

        return existing;
      }

      existing.destroy();
    }


    const connection =
      joinVoiceChannel({

        channelId: channel.id,

        guildId: guild.id,

        adapterCreator:
          guild.voiceAdapterCreator,

        selfDeaf: true,

        selfMute: false

      });


    await entersState(
      connection,
      VoiceConnectionStatus.Ready,
      30000
    );


    console.log(
      `✅ Connected to ${channel.name} in ${guild.name}`
    );


    return connection;

  } catch (error) {

    console.error(
      `❌ Voice connection error in ${guild.id}:`,
      error
    );

    throw error;
  }
}


// =====================================
// AUTO RECONNECT
// =====================================

async function reconnectGuild(
  guildId,
  channelId
) {

  try {

    const guild =
      client.guilds.cache.get(
        guildId
      );

    if (!guild) {
      return;
    }

    await connectToVoiceChannel(
      guild,
      channelId
    );

    console.log(
      `🔄 Reconnected to saved Voice Channel in ${guild.name}`
    );

  } catch (error) {

    console.error(
      '❌ Auto reconnect failed:',
      error.message
    );
  }
}


// =====================================
// READY
// =====================================

client.once(
  'clientReady',
  async () => {

    console.log(
      `✅ Bot Online: ${client.user.tag}`
    );


    // ===============================
    // BOT STATUS
    // ===============================

    client.user.setPresence({

      status: PresenceUpdateStatus.DoNotDisturb,

      activities: [

        {

          name:
            '<a:Scubbacat:1542552078382272532>',

          type:
            ActivityType.Custom

        }

      ]

    });


    // ===============================
    // LOAD SLASH COMMANDS
    // ===============================

    try {

      console.log(
        '⏳ Loading slash commands...'
      );


      const rest =
        new REST({
          version: '10'
        })
        .setToken(TOKEN);


      await rest.put(
        Routes.applicationCommands(
          CLIENT_ID
        ),
        {
          body: commands
        }
      );


      console.log(
        '✅ Slash Commands Loaded!'
      );

    } catch (error) {

      console.error(
        '❌ Command loading error:',
        error
      );
    }


    // ===============================
    // AUTO RETURN AFTER RESTART
    // ===============================

    console.log(
      '🔄 Checking saved Voice Channels...'
    );


    for (
      const [guildId, channelId]
      of Object.entries(
        savedVoiceChannels
      )
    ) {

      try {

        await reconnectGuild(
          guildId,
          channelId
        );

      } catch (error) {

        console.error(
          `❌ Could not reconnect ${guildId}`
        );
      }

    }

  }
);


// =====================================
// INTERACTIONS
// =====================================

client.on(
  'interactionCreate',
  async interaction => {

    try {


      // =============================
      // ONLY SLASH COMMANDS
      // =============================

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }


      const command =
        interaction.commandName;


      // =============================
      // CONNECT
      // =============================

      if (
        command === 'connect'
      ) {

        if (
          !interaction.inGuild()
        ) {

          return safeReply(
            interaction,
            {
              content:
                '❌ This command can only be used inside a Discord server.'
            }
          );
        }


        const allowed =
          await adminOnly(
            interaction
          );

        if (!allowed) {
          return;
        }


        const voiceChannel =
          interaction.member
            ?.voice
            ?.channel;


        if (!voiceChannel) {

          return safeReply(
            interaction,
            {
              content:
                '❌ You must join a Voice Channel first.',

              flags:
                MessageFlags.Ephemeral
            }
          );
        }


        await interaction.deferReply({
          flags:
            MessageFlags.Ephemeral
        });


        await connectToVoiceChannel(
          interaction.guild,
          voiceChannel.id
        );


        // SAVE CHANNEL
        savedVoiceChannels[
          interaction.guild.id
        ] = voiceChannel.id;


        saveVoiceChannels(
          savedVoiceChannels
        );


        await interaction.editReply({
          content:
            `✅ Connected to **${voiceChannel.name}**.\n\n` +
            '🔒 The bot will stay connected until an administrator uses `/disconnect`.'
        });


        return;
      }


      // =============================
      // DISCONNECT
      // =============================

      if (
        command === 'disconnect'
      ) {

        if (
          !interaction.inGuild()
        ) {

          return safeReply(
            interaction,
            {
              content:
                '❌ This command can only be used inside a Discord server.'
            }
          );
        }


        const allowed =
          await adminOnly(
            interaction
          );

        if (!allowed) {
          return;
        }


        const connection =
          getVoiceConnection(
            interaction.guild.id
          );


        // DELETE SAVED CHANNEL FIRST
        delete savedVoiceChannels[
          interaction.guild.id
        ];


        saveVoiceChannels(
          savedVoiceChannels
        );


        if (connection) {

          connection.destroy();

          return safeReply(
            interaction,
            {
              content:
                '👋 Bot disconnected from the Voice Channel.',

              flags:
                MessageFlags.Ephemeral
            }
          );
        }


        return safeReply(
          interaction,
          {
            content:
              '❌ The bot is not connected to a Voice Channel.',

            flags:
              MessageFlags.Ephemeral
          }
        );
      }


      // =============================
      // INVITE
      // =============================

      if (
        command === 'invite'
      ) {

        const inviteURL =
          `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;


        const row =
          new ActionRowBuilder()
            .addComponents(

              new ButtonBuilder()

                .setLabel(
                  'Invite Bot'
                )

                .setStyle(
                  ButtonStyle.Link
                )

                .setURL(
                  inviteURL
                )

                .setEmoji(
                  '➕'
                )

            );


        return safeReply(
          interaction,
          {
            content:
              '🤖 **Invite the bot to your Discord server:**',

            components:
              [row],

            ...(interaction.inGuild()
              ? {
                  flags:
                    MessageFlags.Ephemeral
                }
              : {})
          }
        );
      }


      // =============================
      // HELP
      // =============================

      if (
        command === 'help'
      ) {

        const embed =
          new EmbedBuilder()

            .setTitle(
              '🤖 Bot Help'
            )

            .setDescription(
              'This bot is a Voice Channel connection bot.\n\n' +

              '**/connect**\n' +
              'Connect the bot to your current Voice Channel.\n' +
              '🔒 Administrator only.\n\n' +

              '**/disconnect**\n' +
              'Disconnect the bot from the Voice Channel.\n' +
              '🔒 Administrator only.\n\n' +

              '**/invite**\n' +
              'Get the bot invite link.\n\n' +

              '**/help**\n' +
              'Show this help menu.\n\n' +

              '🔄 The bot remembers the last Voice Channel and attempts to reconnect after a restart.'
            )

            .setColor(
              '#5865F2'
            );


        const row =
          new ActionRowBuilder()
            .addComponents(

              new ButtonBuilder()

                .setLabel(
                  'Support Server'
                )

                .setStyle(
                  ButtonStyle.Link
                )

                .setURL(
                  SUPPORT_SERVER
                )

                .setEmoji(
                  '💬'
                )

            );


        return safeReply(
          interaction,
          {
            embeds:
              [embed],

            components:
              [row],

            ...(interaction.inGuild()
              ? {
                  flags:
                    MessageFlags.Ephemeral
                }
              : {})
          }
        );
      }


    } catch (error) {

      console.error(
        '❌ Interaction Error:',
        error
      );


      try {

        if (
          interaction.deferred
        ) {

          await interaction.editReply({
            content:
              '❌ An error occurred.'
          });

        } else if (
          !interaction.replied
        ) {

          await interaction.reply({
            content:
              '❌ An error occurred.',

            flags:
              interaction.inGuild()
                ? MessageFlags.Ephemeral
                : undefined
          });
        }

      } catch (replyError) {

        console.error(
          '❌ Reply Error:',
          replyError
        );
      }

    }

  }
);


// =====================================
// LOGIN
// =====================================

client.login(TOKEN);
