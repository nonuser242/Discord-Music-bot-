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
  console.error('❌ TOKEN lama helin!');
  console.error('Isticmaal: export TOKEN="BOT_TOKEN_KAAGA"');
  process.exit(1);
}


/* =========================
   DISCORD CLIENT
========================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});


/* =========================
   SERVER MUSIC DATA
========================= */

const players = new Map();


/* =========================
   SLASH COMMANDS
========================= */

const commands = [

  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Ku daar hees Voice Call-ka.')
    .addStringOption(option =>
      option
        .setName('song')
        .setDescription('Magaca heesta ama YouTube link')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Bot-ka geli Voice Call-ka.'),

  new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Bot-ka ka saar Voice Call-ka.'),

  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Soo saar linkiga bot-ka.'),

  new SlashCommandBuilder()
    .setName('clean')
    .setDescription('Tirtir ilaa 100 fariimood.')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Tus amarrada bot-ka.')

].map(command => command.toJSON());


/* =========================
   TIME FORMAT
========================= */

function formatMs(ms) {

  if (!ms || ms < 0) {
    return '0:00';
  }

  const secondsTotal = Math.floor(ms / 1000);

  const hours = Math.floor(secondsTotal / 3600);
  const minutes = Math.floor(
    (secondsTotal % 3600) / 60
  );

  const seconds = secondsTotal % 60;

  if (hours > 0) {

    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;

}


/* =========================
   DURATION TO MS
========================= */

function durationToMs(duration) {

  if (!duration || typeof duration !== 'string') {
    return 0;
  }

  const parts = duration.split(':').map(Number);

  if (parts.some(isNaN)) {
    return 0;
  }

  let seconds = 0;

  for (const part of parts) {
    seconds = seconds * 60 + part;
  }

  return seconds * 1000;

}


/* =========================
   LRC PARSER
========================= */

function parseLrc(lrcText) {

  if (!lrcText) {
    return [];
  }

  const lines = lrcText.split('\n');

  const result = [];

  const regex =
    /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;

  for (const line of lines) {

    const match = line.match(regex);

    if (!match) {
      continue;
    }

    const minutes = Number(match[1]);
    const seconds = Number(match[2]);

    let milliseconds = match[3]
      ? Number(match[3].padEnd(3, '0'))
      : 0;

    const timeMs =
      (minutes * 60 * 1000) +
      (seconds * 1000) +
      milliseconds;

    const text = match[4].trim();

    if (text) {
      result.push({
        timeMs,
        text
      });
    }

  }

  return result;

}


/* =========================
   CLEAN SONG TITLE
========================= */

function cleanSongTitle(title) {

  if (!title) {
    return '';
  }

  return title
    .replace(/\(Official Music Video\)/gi, '')
    .replace(/\(Official Video\)/gi, '')
    .replace(/\(Official Audio\)/gi, '')
    .replace(/\(Lyrics\)/gi, '')
    .replace(/\(Lyric Video\)/gi, '')
    .replace(/\[Official.*?\]/gi, '')
    .replace(/\[Lyrics.*?\]/gi, '')
    .trim();

}


/* =========================
   FETCH LYRICS
========================= */

async function fetchLyrics(songTitle) {

  try {

    const title =
      cleanSongTitle(songTitle);

    const url =
      `https://lrclib.net/api/search?q=${encodeURIComponent(title)}`;

    const response =
      await fetch(url, {
        headers: {
          'User-Agent': 'Discord Music Bot'
        }
      });

    if (!response.ok) {
      return [];
    }

    const data =
      await response.json();

    if (!Array.isArray(data)) {
      return [];
    }

    const synced =
      data.find(
        item =>
          item.syncedLyrics
      );

    if (synced?.syncedLyrics) {

      return parseLrc(
        synced.syncedLyrics
      );

    }

    return [];

  } catch (error) {

    console.log(
      'Lyrics Error:',
      error.message
    );

    return [];

  }

}


/* =========================
   PROGRESS BAR
========================= */

function createProgressBar(
  currentMs,
  duration
) {

  const totalMs =
    durationToMs(duration);

  if (!totalMs) {

    return '`[🔘▬▬▬▬▬▬▬▬▬▬]` `0:00`';

  }

  const percentage =
    Math.min(
      Math.max(
        currentMs / totalMs,
        0
      ),
      1
    );

  const size = 12;

  const position =
    Math.round(
      percentage * size
    );

  let bar = '';

  for (
    let i = 0;
    i <= size;
    i++
  ) {

    if (i === position) {

      bar += '🔘';

    } else {

      bar += '▬';

    }

  }

  return (
    `\`[${bar}]\` ` +
    `\`${formatMs(currentMs)} / ${duration}\``
  );

}


/* =========================
   MUSIC EMBED
========================= */

function createMusicEmbed(
  musicData,
  finished = false
) {

  const song =
    musicData.current;

  if (!song) {
    return null;
  }

  const playbackMs =
    musicData.resource?.playbackDuration || 0;

  const volume =
    Math.round(
      musicData.volume * 100
    );

  const progress =
    finished
      ? `\`[▬▬▬▬▬▬▬▬▬▬▬▬🔘]\` \`${song.duration} / ${song.duration}\``
      : createProgressBar(
          playbackMs,
          song.duration
        );

  let lyric =
    '🎵 Lyrics lama helin.';

  let previous = '';
  let next = '';

  if (
    !finished &&
    song.lyrics &&
    song.lyrics.length
  ) {

    let index = -1;

    for (
      let i = 0;
      i < song.lyrics.length;
      i++
    ) {

      if (
        playbackMs >=
        song.lyrics[i].timeMs
      ) {

        index = i;

      } else {

        break;

      }

    }

    if (index >= 0) {

      lyric =
        song.lyrics[index].text;

      if (index > 0) {

        previous =
          song.lyrics[index - 1].text;

      }

      if (
        index <
        song.lyrics.length - 1
      ) {

        next =
          song.lyrics[index + 1].text;

      }

    }

  }

  let lyricsText = '';

  if (previous) {
    lyricsText += `-# ${previous}\n`;
  }

  lyricsText +=
    `🎤 **${finished ? 'Heestu way dhammaatay' : lyric}**`;

  if (next && !finished) {
    lyricsText +=
      `\n-# ${next}`;
  }

  const loop =
    musicData.loop
      ? '🔂 ON'
      : '❌ OFF';

  const embed =
    new EmbedBuilder()

      .setTitle(
        finished
          ? '🏁 MUSIC FINISHED'
          : '🎧 NOW PLAYING'
      )

      .setDescription(
        `🎵 **[${song.title}](${song.url})**\n\n` +

        `🔊 Volume: \`${volume}%\`\n` +

        `🔁 Loop: ${loop}\n\n` +

        `${progress}\n\n` +

        `${lyricsText}`
      )

      .setColor(
        finished
          ? '#2f3136'
          : '#ff007f'
      );

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

function createMusicButtons() {

  const row =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            'pause_resume'
          )
          .setEmoji('⏯️')
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            'skip'
          )
          .setEmoji('⏩')
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            'loop'
          )
          .setEmoji('🔁')
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            'volume'
          )
          .setEmoji('🔊')
          .setStyle(
            ButtonStyle.Success
          )

      );

  return [row];

}


/* =========================
   UPDATE MUSIC MESSAGE
========================= */

async function updateMusicMessage(
  musicData
) {

  if (
    !musicData.message ||
    !musicData.current
  ) {
    return;
  }

  try {

    const embed =
      createMusicEmbed(
        musicData
      );

    await musicData.message.edit({
      embeds: [embed],
      components:
        createMusicButtons()
    });

  } catch (error) {}

}


/* =========================
   PLAY SONG
========================= */

async function playSong(
  guildId,
  song
) {

  const musicData =
    players.get(guildId);

  if (!musicData) {
    return;
  }

  try {

    musicData.current =
      song;

    if (
      !song.lyrics ||
      !song.lyrics.length
    ) {

      song.lyrics =
        await fetchLyrics(
          song.title
        );

    }

    console.log(
      `🎵 Playing: ${song.url}`
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

    resource.volume.setVolume(
      musicData.volume
    );

    musicData.resource =
      resource;

    musicData.player.play(
      resource
    );

    if (
      musicData.updateInterval
    ) {

      clearInterval(
        musicData.updateInterval
      );

    }

    musicData.updateInterval =
      setInterval(
        () => {

          if (
            musicData.player.state
              .status ===
            AudioPlayerStatus.Playing
          ) {

            updateMusicMessage(
              musicData
            );

          }

        },
        2000
      );

    await updateMusicMessage(
      musicData
    );

  } catch (error) {

    console.error(
      '❌ PLAY ERROR:',
      error
    );

    await playNext(
      guildId
    );

  }

}


/* =========================
   PLAY NEXT
========================= */

async function playNext(
  guildId
) {

  const musicData =
    players.get(guildId);

  if (!musicData) {
    return;
  }

  if (
    musicData.updateInterval
  ) {

    clearInterval(
      musicData.updateInterval
    );

    musicData.updateInterval =
      null;

  }

  if (
    musicData.loop &&
    musicData.current
  ) {

    return playSong(
      guildId,
      musicData.current
    );

  }

  if (
    musicData.queue.length === 0
  ) {

    // Bot-ku Call-ka kama baxayo.
    // Wuxuu joogayaa ilaa /disconnect

    if (
      musicData.message &&
      musicData.current
    ) {

      try {

        const embed =
          createMusicEmbed(
            musicData,
            true
          );

        await musicData.message.edit({
          embeds: [embed],
          components: []
        });

      } catch (error) {}

    }

    musicData.current =
      null;

    return;

  }

  const nextSong =
    musicData.queue.shift();

  await playSong(
    guildId,
    nextSong
  );

}


/* =========================
   CREATE PLAYER
========================= */

function createMusicPlayer(
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

  const musicData = {

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
    musicData
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
    error => {

      console.error(
        'Player Error:',
        error.message
      );

    }
  );

  return musicData;

}


/* =========================
   READY
========================= */

client.once(
  'ready',
  async () => {

    console.log(
      `✅ Bot Online: ${client.user.tag}`
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
      })
      .setToken(TOKEN);

    try {

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
        '✅ Slash Commands Loaded!'
      );

    } catch (error) {

      console.error(
        'Command Error:',
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

    if (
      !interaction.guild
    ) {
      return;
    }

    try {

      /* =====================
         SLASH COMMANDS
      ===================== */

      if (
        interaction.isChatInputCommand()
      ) {

        const command =
          interaction.commandName;


        /* PLAY */

        if (
          command === 'play'
        ) {

          const query =
            interaction.options
              .getString('song')
              ?.trim();

          const voiceChannel =
            interaction.member
              .voice
              .channel;

          if (!voiceChannel) {

            return interaction.reply({
              content:
                '❌ Horta gal Voice Call!',
              flags:
                MessageFlags.Ephemeral
            });

          }

          await interaction.deferReply();

          let song;


          /* URL AMA SEARCH */

          const validation =
            await play.validate(
              query
            );

          console.log(
            `🔎 Query: ${query}`
          );

          console.log(
            `Validation: ${validation}`
          );


          if (
            validation ===
            'yt_video'
          ) {

            const info =
              await play.video_info(
                query
              );

            const details =
              info.video_details;

            song = {

              title:
                details.title,

              url:
                details.url,

              thumbnail:
                details.thumbnails
                  ?.at(-1)
                  ?.url || '',

              duration:
                details.durationRaw ||
                '0:00',

              lyrics:
                []

            };

          } else {

            console.log(
              '🔎 Searching YouTube...'
            );

            const results =
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

            if (
              !results ||
              results.length === 0
            ) {

              return interaction.editReply(
                '❌ Hees lama helin!'
              );

            }

            const video =
              results[0];

            if (
              !video ||
              !video.url
            ) {

              return interaction.editReply(
                '❌ YouTube result sax ah lama helin!'
              );

            }

            song = {

              title:
                video.title ||
                'Unknown Song',

              url:
                video.url,

              thumbnail:
                video.thumbnails
                  ?.at(-1)
                  ?.url || '',

              duration:
                video.durationRaw ||
                '0:00',

              lyrics:
                []

            };

          }


          /* CONNECTION */

          let connection =
            getVoiceConnection(
              interaction.guild.id
            );

          if (!connection) {

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

            await entersState(
              connection,
              VoiceConnectionStatus.Ready,
              30000
            );

          }


          /* PLAYER */

          let musicData =
            players.get(
              interaction.guild.id
            );

          if (!musicData) {

            musicData =
              createMusicPlayer(
                interaction.guild.id,
                connection
              );

            connection.subscribe(
              musicData.player
            );

          }


          /* QUEUE */

          if (
            musicData.current
          ) {

            musicData.queue.push(
              song
            );

            return interaction.editReply(
              `➕ **${song.title}** safka ayaa lagu daray!`
            );

          }


          /* PLAY */

          await playSong(
            interaction.guild.id,
            song
          );


          const embed =
            createMusicEmbed(
              musicData
            );

          await interaction.editReply({
            embeds: [embed],
            components:
              createMusicButtons()
          });


          musicData.message =
            await interaction.fetchReply();

          return;

        }


        /* CONNECT */

        if (
          command === 'connect'
        ) {

          const voiceChannel =
            interaction.member
              .voice
              .channel;

          if (!voiceChannel) {

            return interaction.reply({
              content:
                '❌ Horta gal Voice Call!',
              flags:
                MessageFlags.Ephemeral
            });

          }

          let connection =
            getVoiceConnection(
              interaction.guild.id
            );

          if (!connection) {

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

          }

          return interaction.reply(
            `🎤 Bot-ku wuxuu galay **${voiceChannel.name}**`
          );

        }


        /* DISCONNECT */

        if (
          command === 'disconnect'
        ) {

          const connection =
            getVoiceConnection(
              interaction.guild.id
            );

          if (connection) {

            connection.destroy();

          }

          const musicData =
            players.get(
              interaction.guild.id
            );

          if (
            musicData?.updateInterval
          ) {

            clearInterval(
              musicData.updateInterval
            );

          }

          players.delete(
            interaction.guild.id
          );

          return interaction.reply(
            '👋 Bot-ku wuxuu ka baxay Voice Call-ka.'
          );

        }


        /* INVITE */

        if (
          command === 'invite'
        ) {

          const inviteUrl =
            `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;

          const row =
            new ActionRowBuilder()
              .addComponents(

                new ButtonBuilder()
                  .setLabel(
                    'Add Bot'
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
              '🔗 Ku dar Bot-ka Server-kaaga:',

            components:
              [row]

          });

        }


        /* CLEAN */

        if (
          command === 'clean'
        ) {

          if (
            !interaction.member
              .permissions
              .has(
                PermissionFlagsBits
                  .ManageMessages
              )
          ) {

            return interaction.reply({

              content:
                '❌ Permission ma lihid!',

              flags:
                MessageFlags.Ephemeral

            });

          }

          await interaction.deferReply({
            flags:
              MessageFlags.Ephemeral
          });

          const deleted =
            await interaction.channel
              .bulkDelete(
                100,
                true
              );

          return interaction.editReply(
            `🧹 ${deleted.size} fariimood ayaa la tirtiray!`
          );

        }


        /* HELP */

        if (
          command === 'help'
        ) {

          const embed =
            new EmbedBuilder()

              .setTitle(
                '📖 MUSIC BOT HELP'
              )

              .setDescription(

                '`/play <song>`\nKu daar hees.\n\n' +

                '`/connect`\nBot-ka geli Voice Call.\n\n' +

                '`/disconnect`\nBot-ka ka saar Voice Call.\n\n' +

                '`/clean`\nTirtir 100 fariimood.\n\n' +

                '`/invite`\nSoo saar Invite Link.\n\n' +

                '`⏯️`\nPause / Resume.\n\n' +

                '`⏩`\nSkip song.\n\n' +

                '`🔁`\nLoop song.\n\n' +

                '`🔊`\nBeddel Volume.'

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

        const musicData =
          players.get(
            interaction.guild.id
          );

        if (
          !musicData ||
          !musicData.current
        ) {

          return interaction.reply({

            content:
              '❌ Wax hees ah ma socoto!',

            flags:
              MessageFlags.Ephemeral

          });

        }


        /* PAUSE */

        if (
          interaction.customId ===
          'pause_resume'
        ) {

          if (
            musicData.player
              .state.status ===
            AudioPlayerStatus.Paused
          ) {

            musicData.player.unpause();

            return interaction.reply({

              content:
                '▶️ Heesta waa la sii waday.',

              flags:
                MessageFlags.Ephemeral

            });

          }

          musicData.player.pause();

          return interaction.reply({

            content:
              '⏸️ Heesta waa la hakiyay.',

            flags:
              MessageFlags.Ephemeral

          });

        }


        /* SKIP */

        if (
          interaction.customId ===
          'skip'
        ) {

          musicData.player.stop();

          return interaction.reply({

            content:
              '⏩ Heesta waa la skip-gareeyay.',

            flags:
              MessageFlags.Ephemeral

          });

        }


        /* LOOP */

        if (
          interaction.customId ===
          'loop'
        ) {

          musicData.loop =
            !musicData.loop;

          await updateMusicMessage(
            musicData
          );

          return interaction.reply({

            content:
              musicData.loop
                ? '🔂 Loop waa ON'
                : '❌ Loop waa OFF',

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
                'Beddel Volume'
              );

          const input =
            new TextInputBuilder()

              .setCustomId(
                'volume_input'
              )

              .setLabel(
                'Volume 1 ilaa 100'
              )

              .setStyle(
                TextInputStyle.Short
              )

              .setPlaceholder(
                '50'
              )

              .setRequired(
                true
              );

          modal.addComponents(

            new ActionRowBuilder()
              .addComponents(
                input
              )

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

          const musicData =
            players.get(
              interaction.guild.id
            );

          const value =
            Number(
              interaction.fields
                .getTextInputValue(
                  'volume_input'
                )
            );

          if (
            !musicData
          ) {

            return interaction.reply({

              content:
                '❌ Wax hees ah ma socoto!',

              flags:
                MessageFlags.Ephemeral

            });

          }

          if (
            !Number.isInteger(
              value
            ) ||
            value < 1 ||
            value > 100
          ) {

            return interaction.reply({

              content:
                '❌ Geli 1 ilaa 100!',

              flags:
                MessageFlags.Ephemeral

            });

          }

          musicData.volume =
            value / 100;

          if (
            musicData.resource
              ?.volume
          ) {

            musicData.resource
              .volume
              .setVolume(
                musicData.volume
              );

          }

          await updateMusicMessage(
            musicData
          );

          return interaction.reply({

            content:
              `🔊 Volume: **${value}%**`,

            flags:
              MessageFlags.Ephemeral

          });

        }

      }

    } catch (error) {

      console.error(
        '❌ Interaction Error:',
        error
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        await interaction
          .editReply(
            '❌ Error ayaa dhacay.'
          )
          .catch(() => {});

      } else {

        await interaction
          .reply({

            content:
              '❌ Error ayaa dhacay.',

            flags:
              MessageFlags.Ephemeral

          })
          .catch(() => {});

      }

    }

  }
);


/* =========================
   LOGIN
========================= */

client.login(TOKEN);
