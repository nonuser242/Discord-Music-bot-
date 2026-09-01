const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActivityType,
  PermissionFlagsBits
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  NoSubscriberBehavior
} = require('@discordjs/voice');

const play = require('@iamtraction/play-dl');

/* =========================
   CONFIG
========================= */

const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1543273003822092469';

if (!TOKEN) {
  console.error('❌ TOKEN environment variable is missing!');
  process.exit(1);
}

/* =========================
   DISCORD CLIENT
========================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const players = new Map();

/* =========================
   SLASH COMMANDS
========================= */

const commands = [

  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song in your Voice Channel.')
    .addStringOption(option =>
      option
        .setName('song')
        .setDescription('Song name or URL')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Disconnect the bot from the Voice Channel.'),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current song.'),

  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Get the bot invite link.'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all bot commands.'),

  new SlashCommandBuilder()
    .setName('clean')
    .setDescription('Delete up to 100 messages.')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    )

].map(command => command.toJSON());

/* =========================
   TIME FORMAT
========================= */

function formatMs(ms) {

  const totalSeconds = Math.floor(ms / 1000);

  const minutes = Math.floor(totalSeconds / 60);

  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

/* =========================
   DURATION TO MILLISECONDS
========================= */

function durationToMs(duration) {

  if (!duration || duration === 'Unknown') return 0;

  const parts = duration.split(':').map(Number);

  if (parts.length === 2) {

    return (
      parts[0] * 60 +
      parts[1]
    ) * 1000;

  }

  if (parts.length === 3) {

    return (
      parts[0] * 3600 +
      parts[1] * 60 +
      parts[2]
    ) * 1000;

  }

  return 0;
}

/* =========================
   PROGRESS BAR
========================= */

function createProgressBar(current, duration) {

  const total = durationToMs(duration);

  if (!total) {

    return `🔘▬▬▬▬▬▬▬▬▬▬  ${formatMs(current)} / ${duration}`;

  }

  const progress = Math.min(
    Math.max(current / total, 0),
    1
  );

  const size = 10;

  const position = Math.round(
    progress * size
  );

  let bar = '';

  for (let i = 0; i < size; i++) {

    if (i === position) {

      bar += '🔘';

    } else {

      bar += '▬';

    }

  }

  return `${bar}\n${formatMs(current)} / ${duration}`;
}

/* =========================
   MUSIC EMBED
========================= */

function createMusicEmbed(data) {

  const song = data.current;

  if (!song) return null;

  const current =
    data.resource?.playbackDuration || 0;

  const progress =
    createProgressBar(
      current,
      song.duration
    );

  const volume =
    Math.round(data.volume * 100);

  const loop =
    data.loop
      ? 'ON'
      : 'OFF';

  const embed =
    new EmbedBuilder()

      .setTitle('🎵 NOW PLAYING')

      .setDescription(
        `**${song.title}**\n\n` +
        `${progress}\n\n` +
        `🔊 Volume: **${volume}%**\n` +
        `🔁 Loop: **${loop}**\n` +
        `📋 Queue: **${data.queue.length}**`
      )

      .setColor('#ff007f');

  if (song.thumbnail) {

    embed.setThumbnail(
      song.thumbnail
    );

  }

  return embed;
}

/* =========================
   BUTTONS
========================= */

function createButtons() {

  const row =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId('pause')
          .setLabel('Pause')
          .setEmoji('⏯️')
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId('skip')
          .setLabel('Skip')
          .setEmoji('⏩')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('loop')
          .setLabel('Loop')
          .setEmoji('🔁')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('volume')
          .setLabel('Volume')
          .setEmoji('🔊')
          .setStyle(ButtonStyle.Success)

      );

  return [row];
}

/* =========================
   UPDATE MESSAGE
========================= */

async function updateMessage(data) {

  if (
    !data.message ||
    !data.current
  ) return;

  try {

    await data.message.edit({

      embeds: [
        createMusicEmbed(data)
      ],

      components:
        createButtons()

    });

  } catch (error) {}

}

/* =========================
   CREATE PLAYER
========================= */

function createPlayer(
  guildId,
  connection
) {

  const player =
    createAudioPlayer({

      behaviors: {

        noSubscriber:
          NoSubscriberBehavior.Play

      }

    });

  const data = {

    player,

    connection,

    resource: null,

    current: null,

    queue: [],

    volume: 1,

    loop: false,

    message: null,

    updateInterval: null

  };

  players.set(
    guildId,
    data
  );

  connection.subscribe(
    player
  );

  player.on(
    AudioPlayerStatus.Idle,
    async () => {

      await playNext(
        guildId
      );

    }
  );

  player.on(
    'error',
    async error => {

      console.error(
        'PLAYER ERROR:',
        error.message
      );

      await playNext(
        guildId
      );

    }
  );

  return data;
}

/* =========================
   PLAY NEXT
========================= */

async function playNext(
  guildId
) {

  const data =
    players.get(guildId);

  if (!data) return;

  if (
    data.updateInterval
  ) {

    clearInterval(
      data.updateInterval
    );

    data.updateInterval =
      null;

  }

  if (
    data.loop &&
    data.current
  ) {

    return playSong(
      guildId,
      data.current
    );

  }

  if (
    data.queue.length === 0
  ) {

    data.current = null;

    if (data.message) {

      try {

        await data.message.edit({

          content:
            '🏁 **Queue finished.**\nThe bot is still connected to the voice channel.',

          embeds: [],

          components: []

        });

      } catch (error) {}

    }

    return;

  }

  const next =
    data.queue.shift();

  await playSong(
    guildId,
    next
  );

}

/* =========================
   PLAY SONG
========================= */

async function playSong(
  guildId,
  song
) {

  const data =
    players.get(guildId);

  if (!data) return;

  try {

    data.current =
      song;

    console.log(
      `Playing: ${song.title}`
    );

    const stream =
      await play.stream(
        song.url
      );

    const resource =
      createAudioResource(
        stream.stream,
        {

          inputType:
            stream.type,

          inlineVolume:
            true

        }
      );

    resource.volume
      ?.setVolume(
        data.volume
      );

    data.resource =
      resource;

    data.player.play(
      resource
    );

    await updateMessage(
      data
    );

    if (
      data.updateInterval
    ) {

      clearInterval(
        data.updateInterval
      );

    }

    data.updateInterval =
      setInterval(
        () => {

          if (
            data.player.state.status ===
            AudioPlayerStatus.Playing
          ) {

            updateMessage(data)
              .catch(() => {});

          }

        },

        3000
      );

  } catch (error) {

    console.error(
      'PLAY ERROR:',
      error
    );

    await playNext(
      guildId
    );

  }

}

/* =========================
   BOT READY
========================= */

client.once(
  'clientReady',
  async () => {

    console.log(
      `Bot Online: ${client.user.tag}`
    );

    client.user.setActivity(
      '/play | Music',
      {

        type:
          ActivityType.Listening

      }
    );

    const rest =
      new REST({
        version: '10'
      }).setToken(TOKEN);

    try {

      console.log(
        'Loading slash commands...'
      );

      await rest.put(

        Routes.applicationCommands(
          CLIENT_ID
        ),

        {

          body:
            commands

        }

      );

      console.log(
        'Slash Commands Loaded!'
      );

    } catch (error) {

      console.error(
        error
      );

    }

  }
);

/* =========================
   INTERACTIONS
========================= */

client.on(
  'interactionCreate',
  async interaction => {

    try {

      /* =====================
         SLASH COMMANDS
      ===================== */

      if (
        interaction.isChatInputCommand()
      ) {

        const command =
          interaction.commandName;

        /* ===== PLAY ===== */

        if (
          command === 'play'
        ) {

          const voiceChannel =
            interaction.member
              .voice
              .channel;

          if (
            !voiceChannel
          ) {

            return interaction.reply({

              content:
                '❌ Join a Voice Channel first!',

              flags:
                MessageFlags.Ephemeral

            });

          }

          await interaction.deferReply();

          const query =
            interaction.options
              .getString('song');

          let results;

          try {

            results =
              await play.search(
                query,
                {

                  limit: 1,

                  source: {

                    youtube:
                      'video'

                  }

                }
              );

          } catch (error) {

            console.error(
              error
            );

            return interaction.editReply(
              '❌ Could not search for that song.'
            );

          }

          if (
            !results ||
            results.length === 0
          ) {

            return interaction.editReply(
              '❌ Song not found.'
            );

          }

          const video =
            results[0];

          const song = {

            title:
              video.title,

            url:
              video.url,

            thumbnail:
              video.thumbnails
                ?.at(-1)
                ?.url || '',

            duration:
              video.durationRaw ||
              'Unknown'

          };

          let connection =
            getVoiceConnection(
              interaction.guild.id
            );

          /* =====================
             AUTO JOIN CALL
          ===================== */

          if (
            !connection
          ) {

            connection =
              joinVoiceChannel({

                channelId:
                  voiceChannel.id,

                guildId:
                  interaction.guild.id,

                adapterCreator:
                  interaction.guild
                    .voiceAdapterCreator,

                selfDeaf:
                  true

              });

            try {

              await entersState(

                connection,

                VoiceConnectionStatus.Ready,

                30_000

              );

            } catch (error) {

              connection.destroy();

              return interaction.editReply(
                '❌ Failed to join the Voice Channel.'
              );

            }

          }

          let data =
            players.get(
              interaction.guild.id
            );

          if (
            !data
          ) {

            data =
              createPlayer(

                interaction.guild.id,

                connection

              );

          }

          /* =====================
             QUEUE
          ===================== */

          if (
            data.current
          ) {

            data.queue.push(
              song
            );

            return interaction.editReply(

              `➕ Added to queue:\n**${song.title}**`

            );

          }

          /* =====================
             PLAY
          ===================== */

          await playSong(

            interaction.guild.id,

            song

          );

          const embed =
            createMusicEmbed(
              data
            );

          await interaction.editReply({

            embeds: [
              embed
            ],

            components:
              createButtons()

          });

          data.message =
            await interaction.fetchReply();

        }

        /* ===== SKIP ===== */

        if (
          command === 'skip'
        ) {

          const data =
            players.get(
              interaction.guild.id
            );

          if (
            !data?.current
          ) {

            return interaction.reply({

              content:
                '❌ No song is playing.',

              flags:
                MessageFlags.Ephemeral

            });

          }

          data.player.stop();

          return interaction.reply(
            '⏩ Song skipped!'
          );

        }

        /* ===== DISCONNECT ===== */

        if (
          command ===
          'disconnect'
        ) {

          const connection =
            getVoiceConnection(
              interaction.guild.id
            );

          const data =
            players.get(
              interaction.guild.id
            );

          if (
            data?.updateInterval
          ) {

            clearInterval(
              data.updateInterval
            );

          }

          if (
            connection
          ) {

            connection.destroy();

          }

          players.delete(
            interaction.guild.id
          );

          return interaction.reply(
            '👋 Disconnected from the Voice Channel.'
          );

        }

        /* ===== INVITE ===== */

        if (
          command ===
          'invite'
        ) {

          const inviteUrl =
            `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;

          const row =
            new ActionRowBuilder()
              .addComponents(

                new ButtonBuilder()

                  .setLabel(
                    'Add Bot to Discord'
                  )

                  .setStyle(
                    ButtonStyle.Link
                  )

                  .setURL(
                    inviteUrl
                  )

              );

          return interaction.reply({

            content:
              '🔗 Add the bot to your server:',

            components:
              [row]

          });

        }

        /* ===== CLEAN ===== */

        if (
          command ===
          'clean'
        ) {

          await interaction.channel
            .bulkDelete(
              100,
              true
            )
            .catch(
              () => {}
            );

          return interaction.reply({

            content:
              '🧹 Messages cleaned!',

            flags:
              MessageFlags.Ephemeral

          });

        }

        /* ===== HELP ===== */

        if (
          command ===
          'help'
        ) {

          const embed =
            new EmbedBuilder()

              .setTitle(
                '🎵 Music Bot Help'
              )

              .setDescription(

                '`/play <song>` - Play a song\n\n' +

                '`/skip` - Skip current song\n\n' +

                '`/disconnect` - Leave Voice Channel\n\n' +

                '`/clean` - Delete messages\n\n' +

                '`/invite` - Invite the bot\n\n' +

                '`/help` - Show this menu'

              )

              .setColor(
                '#ff007f'
              );

          return interaction.reply({

            embeds:
              [embed]

          });

        }

      }

      /* =====================
         BUTTONS
      ===================== */

      if (
        interaction.isButton()
      ) {

        const data =
          players.get(
            interaction.guild.id
          );

        if (
          !data?.current
        ) {

          return interaction.reply({

            content:
              '❌ No song is playing.',

            flags:
              MessageFlags.Ephemeral

          });

        }

        /* PAUSE / RESUME */

        if (
          interaction.customId ===
          'pause'
        ) {

          if (
            data.player.state.status ===
            AudioPlayerStatus.Paused
          ) {

            data.player.unpause();

            await interaction.reply({

              content:
                '▶️ Resumed!',

              flags:
                MessageFlags.Ephemeral

            });

          } else {

            data.player.pause();

            await interaction.reply({

              content:
                '⏸️ Paused!',

              flags:
                MessageFlags.Ephemeral

            });

          }

        }

        /* SKIP */

        if (
          interaction.customId ===
          'skip'
        ) {

          data.player.stop();

          await interaction.reply({

            content:
              '⏩ Skipped!',

            flags:
              MessageFlags.Ephemeral

          });

        }

        /* LOOP */

        if (
          interaction.customId ===
          'loop'
        ) {

          data.loop =
            !data.loop;

          await updateMessage(
            data
          );

          await interaction.reply({

            content:
              data.loop
                ? '🔁 Loop enabled!'
                : '❌ Loop disabled!',

            flags:
              MessageFlags.Ephemeral

          });

        }

        /* VOLUME */

        if (
          interaction.customId ===
          'volume'
        ) {

          const modal =
            new ModalBuilder()

              .setCustomId(
                'volume_modal'
              )

              .setTitle(
                'Change Volume'
              );

          const input =
            new TextInputBuilder()

              .setCustomId(
                'volume_input'
              )

              .setLabel(
                'Volume (1 - 100)'
              )

              .setStyle(
                TextInputStyle.Short
              )

              .setRequired(
                true
              );

          const row =
            new ActionRowBuilder()
              .addComponents(
                input
              );

          modal.addComponents(
            row
          );

          return interaction.showModal(
            modal
          );

        }

      }

      /* =====================
         VOLUME MODAL
      ===================== */

      if (
        interaction.isModalSubmit()
      ) {

        if (
          interaction.customId ===
          'volume_modal'
        ) {

          const value =
            parseInt(

              interaction.fields
                .getTextInputValue(
                  'volume_input'
                )

            );

          if (
            isNaN(value) ||
            value < 1 ||
            value > 100
          ) {

            return interaction.reply({

              content:
                '❌ Enter a number from 1 to 100.',

              flags:
                MessageFlags.Ephemeral

            });

          }

          const data =
            players.get(
              interaction.guild.id
            );

          if (
            !data
          ) {

            return interaction.reply({

              content:
                '❌ No song is playing.',

              flags:
                MessageFlags.Ephemeral

            });

          }

          data.volume =
            value / 100;

          if (
            data.resource?.volume
          ) {

            data.resource.volume
              .setVolume(
                data.volume
              );

          }

          await updateMessage(
            data
          );

          return interaction.reply({

            content:
              `🔊 Volume set to **${value}%**`,

            flags:
              MessageFlags.Ephemeral

          });

        }

      }

    } catch (error) {

      console.error(
        'INTERACTION ERROR:',
        error
      );

    }

  }
);

/* =========================
   LOGIN
========================= */

client.login(TOKEN);
