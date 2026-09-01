require('dotenv').config();

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
const CLIENT_ID = process.env.CLIENT_ID || '1543273003822092469';

if (!TOKEN) {
  console.error('❌ TOKEN lama helin. Ku dar TOKEN gudaha .env');
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


/* =========================
   PLAYERS
   Server walba player gaar ah
========================= */

const players = new Map();


/* =========================
   COMMANDS
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
    .setDescription('Soo saar linkiga loogu yeero bot-ka.'),

  new SlashCommandBuilder()
    .setName('clean')
    .setDescription('Nadiifi ilaa 100 fariimood.')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hel caawimaad ku saabsan bot-ka.')

].map(command => command.toJSON());


/* =========================
   TIME FUNCTIONS
========================= */

function formatMs(ms) {

  if (!ms || ms < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(ms / 1000);

  const minutes = Math.floor(totalSeconds / 60);

  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}


function durationToMs(duration) {

  if (!duration || duration === 'Unknown') {
    return 0;
  }

  const parts = duration.split(':').map(Number);

  if (parts.some(isNaN)) {
    return 0;
  }

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

function createProgressBar(currentMs, duration) {

  const totalMs = durationToMs(duration);

  const size = 10;

  if (!totalMs) {

    return `🔘▬▬▬▬▬▬▬▬▬▬ \`0:00 / ${duration}\`;

  }

  const progress = Math.max(
    0,
    Math.min(currentMs / totalMs, 1)
  );

  const position = Math.round(progress * size);

  let bar = '';

  for (let i = 0; i <= size; i++) {

    if (i === position) {
      bar += '🔘';
    } else {
      bar += '▬';
    }

  }

  return `${bar}\n\`${formatMs(currentMs)} / ${duration}\``;
}


/* =========================
   LYRICS
========================= */

/*
  LRC synced lyrics parser

  Format:
  [00:10.00] Lyrics text
*/

function parseLrc(lrcText) {

  if (!lrcText) {
    return [];
  }

  const result = [];

  const lines = lrcText.split('\n');

  for (const line of lines) {

    const matches = [
      ...line.matchAll(
        /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g
      )
    ];

    if (!matches.length) {
      continue;
    }

    const text = line
      .replace(
        /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g,
        ''
      )
      .trim();

    if (!text) {
      continue;
    }

    for (const match of matches) {

      const minutes = Number(match[1]);

      const seconds = Number(match[2]);

      let milliseconds = match[3]
        ? Number(
            match[3].padEnd(3, '0')
          )
        : 0;

      const timeMs =
        minutes * 60000 +
        seconds * 1000 +
        milliseconds;

      result.push({
        timeMs,
        text
      });

    }

  }

  return result.sort(
    (a, b) => a.timeMs - b.timeMs
  );
}


/*
  Search synced lyrics

  If synced lyrics are unavailable,
  bot displays:
  Lyrics lama helin.
*/

async function fetchLyrics(songTitle) {

  try {

    const url =
      `https://lrclib.net/api/search?q=${encodeURIComponent(songTitle)}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'DiscordMusicBot/1.0'
      }
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      return [];
    }

    const match = data.find(
      item => item.syncedLyrics
    );

    if (!match) {
      return [];
    }

    return parseLrc(
      match.syncedLyrics
    );

  } catch (error) {

    console.log(
      'Lyrics error:',
      error.message
    );

    return [];

  }

}


/* =========================
   GET CURRENT LYRIC
========================= */

function getLyricsDisplay(song, playbackMs) {

  if (
    !song.parsedLyrics ||
    song.parsedLyrics.length === 0
  ) {

    return '-# Lyrics lama helin.';

  }

  let currentIndex = -1;

  for (
    let i = 0;
    i < song.parsedLyrics.length;
    i++
  ) {

    if (
      playbackMs >=
      song.parsedLyrics[i].timeMs
    ) {

      currentIndex = i;

    } else {

      break;

    }

  }


  let previous = '';
  let current = '🎵 ...';
  let next = '';


  if (currentIndex >= 0) {

    current =
      song.parsedLyrics[currentIndex].text;

    if (currentIndex > 0) {

      previous =
        song.parsedLyrics[
          currentIndex - 1
        ].text;

    }

    if (
      currentIndex <
      song.parsedLyrics.length - 1
    ) {

      next =
        song.parsedLyrics[
          currentIndex + 1
        ].text;

    }

  } else {

    next =
      song.parsedLyrics[0].text;

  }


  let display = '';


  if (previous) {

    display +=
      `-# ${previous}\n`;

  }


  display +=
    `**${current}**`;


  if (next) {

    display +=
      `\n-# ${next}`;

  }


  return display;

}


/* =========================
   EMBED
========================= */

function createMusicEmbed(musicData) {

  const song = musicData.current;

  if (!song) {
    return null;
  }


  const playbackMs =
    musicData.resource?.playbackDuration || 0;


  const volume =
    Math.round(
      musicData.volume * 100
    );


  const loopStatus =
    musicData.loop === 'song'
      ? 'ON 🔁'
      : 'OFF';


  const progress =
    createProgressBar(
      playbackMs,
      song.duration
    );


  const lyrics =
    getLyricsDisplay(
      song,
      playbackMs
    );


  const embed =
    new EmbedBuilder()

      .setTitle(
        '🎧 NOW PLAYING'
      )

      .setDescription(

        `🎵 **[${song.title}](${song.url})**

⏱️ ${progress}

🔊 Volume: \`${volume}%\`
🔁 Loop: \`${loopStatus}\`

**Lyrics**

${lyrics}`

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

function createMusicButtons() {

  return [

    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()

          .setCustomId(
            'pause_resume'
          )

          .setLabel(
            'Pause'
          )

          .setEmoji('⏯️')

          .setStyle(
            ButtonStyle.Primary
          ),


        new ButtonBuilder()

          .setCustomId(
            'skip'
          )

          .setLabel(
            'Skip'
          )

          .setEmoji('⏩')

          .setStyle(
            ButtonStyle.Secondary
          ),


        new ButtonBuilder()

          .setCustomId(
            'volume'
          )

          .setLabel(
            'Volume'
          )

          .setEmoji('🔊')

          .setStyle(
            ButtonStyle.Success
          ),


        new ButtonBuilder()

          .setCustomId(
            'loop'
          )

          .setLabel(
            'Loop'
          )

          .setEmoji('🔁')

          .setStyle(
            ButtonStyle.Secondary
          )

      )

  ];

}


/* =========================
   UPDATE MESSAGE
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

  } catch (error) {

    console.log(
      'Message update error:',
      error.message
    );

  }

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

    loop: 'off',

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


  return musicData;

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


    /*
      Get synced lyrics
    */

    if (
      !song.parsedLyrics
    ) {

      song.parsedLyrics =
        await fetchLyrics(
          song.title
        );

    }


    /*
      Get audio stream
    */

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
        musicData.volume
      );


    musicData.resource =
      resource;


    musicData.player.play(
      resource
    );


    /*
      Update every 2 seconds
    */

    if (
      musicData.updateInterval
    ) {

      clearInterval(
        musicData.updateInterval
      );

    }


    musicData.updateInterval =
      setInterval(() => {

        if (
          musicData.player.state.status ===
          AudioPlayerStatus.Playing
        ) {

          updateMusicMessage(
            musicData
          );

        }

      }, 2000);


    await updateMusicMessage(
      musicData
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
   NEXT SONG
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


  /*
    Loop current song
  */

  if (
    musicData.loop === 'song' &&
    musicData.current
  ) {

    return playSong(
      guildId,
      musicData.current
    );

  }


  /*
    Queue
  */

  if (
    musicData.queue.length > 0
  ) {

    const nextSong =
      musicData.queue.shift();


    return playSong(
      guildId,
      nextSong
    );

  }


  /*
    No more songs
  */

  musicData.current =
    null;

  musicData.resource =
    null;


  if (
    musicData.message
  ) {

    try {

      const embed =
        new EmbedBuilder()

          .setTitle(
            '🎧 MUSIC PLAYER'
          )

          .setDescription(
            '🏁 Heestii waa dhammaatay.'
          )

          .setColor(
            '#2f3136'
          );


      await musicData.message.edit({

        embeds: [embed],

        components: []

      });

    } catch (error) {}

  }

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
        'COMMAND ERROR:',
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

      /*
        DM
      */

      if (
        !interaction.guild
      ) {

        if (
          interaction.isChatInputCommand()
        ) {

          return interaction.reply({

            content:
              '❌ Bot-kan Music-ka Server Voice Channel ayuu u baahan yahay.',

            flags:
              MessageFlags.Ephemeral

          });

        }

        return;

      }


      /* =====================
         SLASH COMMANDS
      ===================== */

      if (
        interaction.isChatInputCommand()
      ) {

        const commandName =
          interaction.commandName;


        /*
          PLAY
        */

        if (
          commandName === 'play'
        ) {

          const voiceChannel =
            interaction.member.voice.channel;


          if (!voiceChannel) {

            return interaction.reply({

              content:
                '❌ Horta gal Voice Channel!',

              flags:
                MessageFlags.Ephemeral

            });

          }


          const query =
            interaction.options
              .getString('song')
              .trim();


          await interaction.deferReply();


          let results;


          try {

            results =
              await play.search(
                query,
                {

                  limit: 1,

                  source: {
                    youtube: 'video'
                  }

                }
              );

          } catch (error) {

            return interaction.editReply(
              '❌ Search-ka ayaa fashilmay.'
            );

          }


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


          const song = {

            title:
              video.title,

            url:
              video.url,

            thumbnail:
              video.thumbnails?.at(-1)?.url ||
              '',

            duration:
              video.durationRaw ||
              'Unknown',

            parsedLyrics:
              null

          };


          let connection =
            getVoiceConnection(
              interaction.guild.id
            );


          /*
            Connect
          */

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


            try {

              await entersState(

                connection,

                VoiceConnectionStatus.Ready,

                30000

              );

            } catch (error) {

              connection.destroy();

              return interaction.editReply(
                '❌ Voice Call-ka lama geli karin.'
              );

            }

          }


          let musicData =
            players.get(
              interaction.guild.id
            );


          /*
            Create server player
          */

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


          /*
            Queue
          */

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


          /*
            Set message first
          */

          const loadingEmbed =
            new EmbedBuilder()

              .setTitle(
                '🎧 Loading...'
              )

              .setDescription(
                `⏳ **${song.title}**`
              )

              .setColor(
                '#ff007f'
              );


          await interaction.editReply({

            embeds:
              [loadingEmbed]

          });


          musicData.message =
            await interaction.fetchReply();


          /*
            Play
          */

          await playSong(

            interaction.guild.id,

            song

          );


          return;

        }


        /*
          CONNECT
        */

        if (
          commandName === 'connect'
        ) {

          const voiceChannel =
            interaction.member.voice.channel;


          if (!voiceChannel) {

            return interaction.reply({

              content:
                '❌ Horta gal Voice Channel!',

              flags:
                MessageFlags.Ephemeral

            });

          }


          let connection =
            getVoiceConnection(
              interaction.guild.id
            );


          if (connection) {

            return interaction.reply({

              content:
                '🎤 Bot-ku hore ayuu Voice Call-ka ugu jiraa.',

              flags:
                MessageFlags.Ephemeral

            });

          }


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

              30000

            );


            return interaction.reply(
              `🎤 Bot-ka wuxuu galay **${voiceChannel.name}**`
            );

          } catch (error) {

            connection.destroy();

            return interaction.reply(
              '❌ Voice Call-ka lama geli karin.'
            );

          }

        }


        /*
          DISCONNECT
        */

        if (
          commandName ===
          'disconnect'
        ) {

          const connection =
            getVoiceConnection(
              interaction.guild.id
            );


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


          if (
            musicData?.player
          ) {

            musicData.player.stop();

          }


          if (connection) {

            connection.destroy();

          }


          players.delete(
            interaction.guild.id
          );


          return interaction.reply(
            '👋 Bot-ku wuxuu ka baxay Voice Call-ka.'
          );

        }


        /*
          INVITE
        */

        if (
          commandName === 'invite'
        ) {

          const inviteUrl =
            `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;


          const row =
            new ActionRowBuilder()

              .addComponents(

                new ButtonBuilder()

                  .setLabel(
                    'Add to Discord'
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
              '🔗 Ku soo dar Bot-ka Server-kaaga:',

            components:
              [row]

          });

        }


        /*
          CLEAN
        */

        if (
          commandName === 'clean'
        ) {

          const deleted =
            await interaction.channel
              .bulkDelete(
                100,
                true
              )
              .catch(
                () => null
              );


          return interaction.reply({

            content:
              deleted
                ? `🧹 ${deleted.size} fariimood ayaa la tirtiray!`
                : '❌ Fariimaha lama tirtiri karin.',

            flags:
              MessageFlags.Ephemeral

          });

        }


        /*
          HELP
        */

        if (
          commandName === 'help'
        ) {

          const embed =
            new EmbedBuilder()

              .setTitle(
                '📖 Music Bot Help'
              )

              .setDescription(

`🎵 \`/play <song>\`
Ku daar hees.

🎤 \`/connect\`
Bot-ka geli Voice Call.

👋 \`/disconnect\`
Bot-ka ka saar Voice Call.

🔗 \`/invite\`
Hel linkiga Bot-ka.

🧹 \`/clean\`
Tirtir ilaa 100 fariimood.

📖 \`/help\`
Caawimaad.

**Buttons**

⏯️ Pause / Resume
⏩ Skip
🔊 Volume
🔁 Loop`

              )

              .setColor(
                '#00ff7f'
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


        /*
          PAUSE / RESUME
        */

        if (
          interaction.customId ===
          'pause_resume'
        ) {

          if (

            musicData.player.state.status ===
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


        /*
          SKIP
        */

        if (
          interaction.customId ===
          'skip'
        ) {

          musicData.loop =
            'off';


          musicData.player.stop();


          return interaction.reply({

            content:
              '⏩ Heesta waa laga gudbay.',

            flags:
              MessageFlags.Ephemeral

          });

        }


        /*
          LOOP
        */

        if (
          interaction.customId ===
          'loop'
        ) {

          musicData.loop =
            musicData.loop === 'song'
              ? 'off'
              : 'song';


          await updateMusicMessage(
            musicData
          );


          return interaction.reply({

            content:
              musicData.loop === 'song'
                ? '🔁 Loop ON'
                : '🔁 Loop OFF',

            flags:
              MessageFlags.Ephemeral

          });

        }


        /*
          VOLUME
        */

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
                'Beddel Volume-ka'
              );


          const input =
            new TextInputBuilder()

              .setCustomId(
                'volume_input'
              )

              .setLabel(
                'Geli Volume (1 - 100)'
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

          const musicData =
            players.get(
              interaction.guild.id
            );


          if (!musicData) {

            return interaction.reply({

              content:
                '❌ Wax hees ah ma socoto!',

              flags:
                MessageFlags.Ephemeral

            });

          }


          const value =
            Number(

              interaction.fields
                .getTextInputValue(
                  'volume_input'
                )

            );


          if (

            !Number.isFinite(value) ||

            value < 1 ||

            value > 100

          ) {

            return interaction.reply({

              content:
                '❌ Geli nambar 1 ilaa 100.',

              flags:
                MessageFlags.Ephemeral

            });

          }


          musicData.volume =
            value / 100;


          if (
            musicData.resource?.volume
          ) {

            musicData.resource.volume
              .setVolume(
                musicData.volume
              );

          }


          await updateMusicMessage(
            musicData
          );


          return interaction.reply({

            content:
              `🔊 Volume waxaa loo beddelay **${value}%**`,

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


      if (
        interaction.isRepliable()
      ) {

        try {

          if (
            interaction.deferred ||
            interaction.replied
          ) {

            await interaction.editReply(
              '❌ Error ayaa dhacay.'
            );

          } else {

            await interaction.reply({

              content:
                '❌ Error ayaa dhacay.',

              flags:
                MessageFlags.Ephemeral

            });

          }

        } catch (e) {}

      }

    }

  }

);


/* =========================
   LOGIN
========================= */

client.login(TOKEN);
