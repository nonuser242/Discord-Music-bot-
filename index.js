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
  PermissionFlagsBits,
  ActivityType,
  MessageFlags
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  NoSubscriberBehavior
} = require("@discordjs/voice");

const play = require("@iamtraction/play-dl");


/* =========================
   CONFIG
========================= */

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || "1543273003822092469";

if (!TOKEN) {
  console.error("❌ TOKEN lama helin!");
  console.error("Kinesis Environment Variables ku dar: TOKEN");
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
   MUSIC PLAYERS
========================= */

const players = new Map();


/* =========================
   COMMANDS
========================= */

const commands = [

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Ku daar hees Voice Channel-ka.")
    .addStringOption(option =>
      option
        .setName("song")
        .setDescription("Magaca heesta ama YouTube link")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("connect")
    .setDescription("Bot-ka geli Voice Channel-ka."),

  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Bot-ka ka saar Voice Channel-ka."),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Ka gudub heesta hadda socota."),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Jooji heesta si ku meel gaar ah."),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Sii wad heesta."),

  new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Arag safka heesaha."),

  new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Hel linkiga lagu daro Bot-ka."),

  new SlashCommandBuilder()
    .setName("clean")
    .setDescription("Tirtir fariimaha channel-ka.")
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("Tirada fariimaha 1 ilaa 100")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    ),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Arag dhammaan amarrada Bot-ka.")

].map(command => command.toJSON());


/* =========================
   TIME FUNCTIONS
========================= */

function formatMs(ms) {

  ms = Math.max(0, ms || 0);

  const totalSeconds = Math.floor(ms / 1000);

  const minutes = Math.floor(totalSeconds / 60);

  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;

}


function durationToSeconds(duration) {

  if (!duration || duration === "Unknown") {
    return 0;
  }

  const parts = duration
    .split(":")
    .map(Number);

  if (parts.some(isNaN)) {
    return 0;
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return (
      parts[0] * 3600 +
      parts[1] * 60 +
      parts[2]
    );
  }

  return 0;

}


/* =========================
   PROGRESS BAR
========================= */

function createProgressBar(
  currentMs,
  duration
) {

  const totalSeconds =
    durationToSeconds(duration);

  if (!totalSeconds) {

    return (
      "`🔘▬▬▬▬▬▬▬▬▬▬` " +
      `\`${formatMs(currentMs)} / ${duration}\``
    );

  }

  const totalMs =
    totalSeconds * 1000;

  const progress =
    Math.min(
      Math.max(
        currentMs / totalMs,
        0
      ),
      1
    );

  const size = 10;

  const position =
    Math.round(progress * size);

  let bar = "";

  for (
    let i = 0;
    i <= size;
    i++
  ) {

    if (i === position) {
      bar += "🔘";
    } else {
      bar += "▬";
    }

  }

  return (
    `\`${bar}\` ` +
    `\`${formatMs(currentMs)} / ${duration}\``
  );

}


/* =========================
   CREATE EMBED
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
    musicData.resource?.playbackDuration ||
    0;

  const progress =
    finished
      ? `\`▬▬▬▬▬▬▬▬▬▬🔘\` \`${song.duration} / ${song.duration}\``
      : createProgressBar(
          playbackMs,
          song.duration
        );

  const volume =
    Math.round(
      musicData.volume * 100
    );

  const loop =
    musicData.loop
      ? "🔂 ON"
      : "❌ OFF";

  const status =
    musicData.player.state.status;

  let playingStatus =
    "▶️ Playing";

  if (
    status ===
    AudioPlayerStatus.Paused
  ) {
    playingStatus = "⏸️ Paused";
  }

  if (finished) {
    playingStatus =
      "🏁 Finished";
  }

  const embed =
    new EmbedBuilder()
      .setTitle(
        finished
          ? "🎧 MUSIC FINISHED"
          : "🎧 NOW PLAYING"
      )
      .setDescription(
        `🎵 **[${song.title}](${song.url})**\n\n` +

        `⏱️ ${progress}\n\n` +

        `🔊 Volume: **${volume}%**\n` +

        `🔁 Loop: **${loop}**\n` +

        `📋 Queue: **${musicData.queue.length}**\n\n` +

        `${playingStatus}`
      )
      .setColor(
        finished
          ? 0x2f3136
          : 0xff007f
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

  const row1 =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId("back_10")
          .setLabel("10s")
          .setEmoji("⏪")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId("pause_resume")
          .setLabel("Pause")
          .setEmoji("⏯️")
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId("forward_10")
          .setLabel("10s")
          .setEmoji("⏩")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId("skip")
          .setLabel("Skip")
          .setEmoji("⏭️")
          .setStyle(
            ButtonStyle.Secondary
          )

      );

  const row2 =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId("loop")
          .setLabel("Loop")
          .setEmoji("🔁")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId("volume")
          .setLabel("Volume")
          .setEmoji("🔊")
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId("disconnect")
          .setLabel("Leave")
          .setEmoji("👋")
          .setStyle(
            ButtonStyle.Danger
          )

      );

  return [
    row1,
    row2
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

    if (!embed) {
      return;
    }

    await musicData.message.edit({
      embeds: [embed],
      components:
        createMusicButtons()
    });

  } catch (error) {

    console.error(
      "MESSAGE UPDATE ERROR:",
      error.message
    );

  }

}


/* =========================
   BOT STATUS
========================= */

function updateBotStatus() {

  let activeSong = null;

  for (
    const data of players.values()
  ) {

    if (data.current) {
      activeSong =
        data.current.title;
      break;
    }

  }

  if (activeSong) {

    client.user.setPresence({

      activities: [
        {
          name:
            `🎵 ${activeSong}`.slice(
              0,
              128
            ),
          type:
            ActivityType.Listening
        }
      ],

      status: "online"

    });

  } else {

    client.user.setPresence({

      activities: [
        {
          name: "/play | Music",
          type:
            ActivityType.Listening
        }
      ],

      status: "online"

    });

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

    guildId,

    player,

    connection,

    resource: null,

    current: null,

    queue: [],

    volume: 1,

    loop: false,

    message: null,

    updateInterval: null,

    seekSeconds: 0,

    manuallyStopped: false

  };

  players.set(
    guildId,
    musicData
  );


  player.on(
    AudioPlayerStatus.Idle,
    async () => {

      if (
        musicData.manuallyStopped
      ) {

        musicData.manuallyStopped =
          false;

        return;

      }

      await playNext(
        guildId
      );

    }
  );


  player.on(
    "error",
    async error => {

      console.error(
        "AUDIO PLAYER ERROR:",
        error.message
      );

      if (
        !musicData.manuallyStopped
      ) {

        await playNext(
          guildId
        );

      }

    }
  );


  return musicData;

}


/* =========================
   GET / JOIN CONNECTION
========================= */

async function getOrJoinVoice(
  interaction
) {

  const guild =
    interaction.guild;

  const voiceChannel =
    interaction.member?.voice?.channel;

  if (!voiceChannel) {
    throw new Error(
      "Horta gal Voice Channel!"
    );
  }

  let connection =
    getVoiceConnection(
      guild.id
    );

  if (!connection) {

    connection =
      joinVoiceChannel({

        channelId:
          voiceChannel.id,

        guildId:
          guild.id,

        adapterCreator:
          guild.voiceAdapterCreator,

        selfDeaf: true

      });

  }

  await entersState(
    connection,
    VoiceConnectionStatus.Ready,
    30000
  );

  return connection;

}


/* =========================
   CREATE SONG
========================= */

async function getSong(
  query
) {

  console.log(
    "🔎 Searching:",
    query
  );

  const results =
    await play.search(
      query,
      {
        limit: 1,
        source: {
          youtube: "video"
        }
      }
    );

  if (
    !results ||
    results.length === 0
  ) {
    return null;
  }

  const video =
    results[0];

  return {

    title:
      video.title ||
      "Unknown Song",

    url:
      video.url,

    thumbnail:
      video.thumbnails?.at(-1)?.url ||
      "",

    duration:
      video.durationRaw ||
      "Unknown"

  };

}


/* =========================
   PLAY SONG
========================= */

async function playSong(
  guildId,
  song,
  seekSeconds = 0
) {

  const musicData =
    players.get(guildId);

  if (
    !musicData ||
    !song
  ) {
    return;
  }

  try {

    musicData.current =
      song;

    musicData.seekSeconds =
      Math.max(
        0,
        seekSeconds
      );

    console.log(
      "🎵 Playing:",
      song.url
    );


    const stream =
      await play.stream(
        song.url,
        {
          seek:
            musicData.seekSeconds
        }
      );


    const resource =
      createAudioResource(
        stream.stream,
        {

          inputType:
            stream.type,

          inlineVolume: true

        }
      );


    if (
      resource.volume
    ) {

      resource.volume.setVolume(
        musicData.volume
      );

    }


    musicData.resource =
      resource;

    musicData.player.play(
      resource
    );


    updateBotStatus();


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
            musicData.player.state.status ===
            AudioPlayerStatus.Playing
          ) {

            updateMusicMessage(
              musicData
            );

          }

        },
        3000
      );


    await updateMusicMessage(
      musicData
    );


  } catch (error) {

    console.error(
      "❌ PLAY ERROR:",
      error
    );


    musicData.current =
      null;

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
    musicData.loop &&
    musicData.current
  ) {

    return playSong(
      guildId,
      musicData.current,
      0
    );

  }


  if (
    musicData.queue.length === 0
  ) {

    musicData.current =
      null;

    musicData.resource =
      null;

    updateBotStatus();

    if (
      musicData.updateInterval
    ) {

      clearInterval(
        musicData.updateInterval
      );

      musicData.updateInterval =
        null;

    }

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
   SEEK
========================= */

async function seekSong(
  guildId,
  secondsChange
) {

  const musicData =
    players.get(guildId);

  if (
    !musicData ||
    !musicData.current
  ) {
    return false;
  }


  const currentSeconds =
    (
      musicData.resource?.playbackDuration ||
      0
    ) / 1000;


  let newSeconds =
    currentSeconds +
    musicData.seekSeconds +
    secondsChange;


  newSeconds =
    Math.max(
      0,
      newSeconds
    );


  const totalSeconds =
    durationToSeconds(
      musicData.current.duration
    );


  if (
    totalSeconds > 0
  ) {

    newSeconds =
      Math.min(
        newSeconds,
        Math.max(
          0,
          totalSeconds - 1
        )
      );

  }


  musicData.manuallyStopped =
    true;


  musicData.player.stop();


  await playSong(
    guildId,
    musicData.current,
    newSeconds
  );


  return true;

}


/* =========================
   DISCONNECT
========================= */

function disconnectGuild(
  guildId
) {

  const musicData =
    players.get(guildId);


  if (musicData) {

    musicData.manuallyStopped =
      true;

    if (
      musicData.updateInterval
    ) {

      clearInterval(
        musicData.updateInterval
      );

    }

    try {

      musicData.player.stop();

    } catch {}


    players.delete(
      guildId
    );

  }


  const connection =
    getVoiceConnection(
      guildId
    );


  if (connection) {

    try {

      connection.destroy();

    } catch {}

  }


  updateBotStatus();

}


/* =========================
   HELP EMBED
========================= */

function createHelpEmbed() {

  return new EmbedBuilder()

    .setTitle(
      "🎵 Music Bot Help"
    )

    .setDescription(

      "**Music Commands**\n\n" +

      "`/play <song>` 🎵\n" +
      "Ku daar hees Voice Channel-ka.\n\n" +

      "`/connect` 🎤\n" +
      "Bot-ka geli Voice Channel.\n\n" +

      "`/disconnect` 👋\n" +
      "Bot-ka ka saar Voice Channel.\n\n" +

      "`/skip` ⏭️\n" +
      "Ka gudub heesta.\n\n" +

      "`/pause` ⏸️\n" +
      "Hakiso heesta.\n\n" +

      "`/resume` ▶️\n" +
      "Sii wad heesta.\n\n" +

      "`/queue` 📋\n" +
      "Arag safka heesaha.\n\n" +

      "`/clean <amount>` 🧹\n" +
      "Tirtir fariimaha.\n\n" +

      "`/invite` 🔗\n" +
      "Hel linkiga Bot-ka.\n\n" +

      "**Buttons**\n" +
      "⏪ 10 seconds gadaal\n" +
      "⏯️ Pause / Resume\n" +
      "⏩ 10 seconds hore\n" +
      "⏭️ Skip\n" +
      "🔁 Loop\n" +
      "🔊 Volume\n" +
      "👋 Leave"

    )

    .setColor(
      0xff007f
    );

}


/* =========================
   READY
========================= */

client.once(
  "ready",
  async () => {

    console.log(
      `✅ Bot Online: ${client.user.tag}`
    );


    updateBotStatus();


    const rest =
      new REST({
        version: "10"
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
        "✅ Slash Commands Loaded!"
      );


    } catch (error) {

      console.error(
        "COMMAND ERROR:",
        error
      );

    }

  }
);


/* =========================
   INTERACTIONS
========================= */

client.on(
  "interactionCreate",
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


        /* HELP */

        if (
          command === "help"
        ) {

          return interaction.reply({
            embeds: [
              createHelpEmbed()
            ],
            flags:
              MessageFlags.Ephemeral
          });

        }


        /* INVITE */

        if (
          command === "invite"
        ) {

          const inviteUrl =
            `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;


          const row =
            new ActionRowBuilder()
              .addComponents(

                new ButtonBuilder()
                  .setLabel(
                    "Add to Discord"
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
              "🔗 **Ku soo dar Bot-ka Server-kaaga:**",

            components:
              [row],

            flags:
              MessageFlags.Ephemeral

          });

        }


        /*
          Commands-ka hoose
          waxay u baahan yihiin Server
        */

        if (
          !interaction.guild
        ) {

          return interaction.reply({

            content:
              "❌ Command-kan DM gudaheeda kama shaqeeyo. `/help` iyo `/invite` ayaad DM ku isticmaali kartaa.",

            flags:
              MessageFlags.Ephemeral

          });

        }


        /* CONNECT */

        if (
          command === "connect"
        ) {

          const connection =
            await getOrJoinVoice(
              interaction
            );


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

          }


          connection.subscribe(
            musicData.player
          );


          return interaction.reply(
            "🎤 Bot-ku wuxuu galay Voice Channel-ka!"
          );

        }


        /* DISCONNECT */

        if (
          command === "disconnect"
        ) {

          disconnectGuild(
            interaction.guild.id
          );


          return interaction.reply(
            "👋 Bot-ka wuxuu ka baxay Voice Channel-ka."
          );

        }


        /* PLAY */

        if (
          command === "play"
        ) {

          const query =
            interaction.options
              .getString("song")
              ?.trim();


          if (!query) {

            return interaction.reply({

              content:
                "❌ Geli magaca heesta ama YouTube link!",

              flags:
                MessageFlags.Ephemeral

            });

          }


          const voiceChannel =
            interaction.member
              ?.voice
              ?.channel;


          if (!voiceChannel) {

            return interaction.reply({

              content:
                "❌ Horta gal Voice Channel!",

              flags:
                MessageFlags.Ephemeral

            });

          }


          await interaction.deferReply();


          const song =
            await getSong(
              query
            );


          if (!song) {

            return interaction.editReply(
              "❌ Hees lama helin!"
            );

          }


          const connection =
            await getOrJoinVoice(
              interaction
            );


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

          }


          musicData.connection =
            connection;


          connection.subscribe(
            musicData.player
          );


          /*
            Haddii hees socoto,
            queue geli
          */

          if (
            musicData.current
          ) {

            musicData.queue.push(
              song
            );


            return interaction.editReply(
              `➕ **${song.title}** ayaa safka lagu daray!`
            );

          }


          /*
            Message marka hore samee
            si embed undefined error uusan u dhicin
          */

          musicData.current =
            song;


          const embed =
            createMusicEmbed(
              musicData
            );


          if (!embed) {

            return interaction.editReply(
              "❌ Embed lama samayn karin."
            );

          }


          await interaction.editReply({

            embeds:
              [embed],

            components:
              createMusicButtons()

          });


          musicData.message =
            await interaction.fetchReply();


          /*
            Kadib music play
          */

          await playSong(
            interaction.guild.id,
            song,
            0
          );


          return;

        }


        /* SKIP */

        if (
          command === "skip"
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
                "❌ Wax hees ah ma socoto!",

              flags:
                MessageFlags.Ephemeral

            });

          }


          musicData.player.stop();


          return interaction.reply(
            "⏭️ Heesta waa laga gudbay!"
          );

        }


        /* PAUSE */

        if (
          command === "pause"
        ) {

          const musicData =
            players.get(
              interaction.guild.id
            );


          if (!musicData) {

            return interaction.reply({

              content:
                "❌ Wax hees ah ma socoto!",

              flags:
                MessageFlags.Ephemeral

            });

          }


          musicData.player.pause();


          await updateMusicMessage(
            musicData
          );


          return interaction.reply({

            content:
              "⏸️ Heesta waa la hakiyay.",

            flags:
              MessageFlags.Ephemeral

          });

        }


        /* RESUME */

        if (
          command === "resume"
        ) {

          const musicData =
            players.get(
              interaction.guild.id
            );


          if (!musicData) {

            return interaction.reply({

              content:
                "❌ Wax hees ah ma socoto!",

              flags:
                MessageFlags.Ephemeral

            });

          }


          musicData.player.unpause();


          await updateMusicMessage(
            musicData
          );


          return interaction.reply({

            content:
              "▶️ Heesta waa la sii waday.",

            flags:
              MessageFlags.Ephemeral

          });

        }


        /* QUEUE */

        if (
          command === "queue"
        ) {

          const musicData =
            players.get(
              interaction.guild.id
            );


          if (
            !musicData ||
            musicData.queue.length === 0
          ) {

            return interaction.reply({

              content:
                "📋 Safka heesaha waa madhan.",

              flags:
                MessageFlags.Ephemeral

            });

          }


          const queueText =
            musicData.queue
              .slice(0, 10)
              .map(
                (song, index) =>
                  `**${index + 1}.** ${song.title}`
              )
              .join("\n");


          const embed =
            new EmbedBuilder()

              .setTitle(
                "📋 Music Queue"
              )

              .setDescription(
                queueText
              )

              .setColor(
                0xff007f
              );


          return interaction.reply({

            embeds:
              [embed],

            flags:
              MessageFlags.Ephemeral

          });

        }


        /* CLEAN */

        if (
          command === "clean"
        ) {

          const amount =
            interaction.options
              .getInteger(
                "amount"
              );


          await interaction.channel.bulkDelete(
            amount,
            true
          );


          return interaction.reply({

            content:
              `🧹 ${amount} fariimood waa la tirtiray.`,

            flags:
              MessageFlags.Ephemeral

          });

        }

      }


      /* =====================
         BUTTONS
      ===================== */

      if (
        interaction.isButton()
      ) {

        if (
          !interaction.guild
        ) {
          return;
        }


        const guildId =
          interaction.guild.id;


        const musicData =
          players.get(
            guildId
          );


        /* DISCONNECT BUTTON */

        if (
          interaction.customId ===
          "disconnect"
        ) {

          disconnectGuild(
            guildId
          );


          return interaction.reply({

            content:
              "👋 Bot-ka wuxuu ka baxay Voice Channel-ka.",

            flags:
              MessageFlags.Ephemeral

          });

        }


        if (
          !musicData ||
          !musicData.current
        ) {

          return interaction.reply({

            content:
              "❌ Wax hees ah ma socoto!",

            flags:
              MessageFlags.Ephemeral

          });

        }


        /* PAUSE / RESUME */

        if (
          interaction.customId ===
          "pause_resume"
        ) {

          if (
            musicData.player.state.status ===
            AudioPlayerStatus.Paused
          ) {

            musicData.player.unpause();


            await interaction.reply({

              content:
                "▶️ Heesta waa la sii waday.",

              flags:
                MessageFlags.Ephemeral

            });

          } else {

            musicData.player.pause();


            await interaction.reply({

              content:
                "⏸️ Heesta waa la hakiyay.",

              flags:
                MessageFlags.Ephemeral

            });

          }


          await updateMusicMessage(
            musicData
          );

        }


        /* SKIP */

        else if (
          interaction.customId ===
          "skip"
        ) {

          musicData.player.stop();


          await interaction.reply({

            content:
              "⏭️ Heesta waa laga gudbay!",

            flags:
              MessageFlags.Ephemeral

          });

        }


        /* BACK 10 */

        else if (
          interaction.customId ===
          "back_10"
        ) {

          await interaction.deferReply({

            flags:
              MessageFlags.Ephemeral

          });


          await seekSong(
            guildId,
            -10
          );


          await interaction.editReply(
            "⏪ 10 seconds gadaal ayaa loo celiyay."
          );

        }


        /* FORWARD 10 */

        else if (
          interaction.customId ===
          "forward_10"
        ) {

          await interaction.deferReply({

            flags:
              MessageFlags.Ephemeral

          });


          await seekSong(
            guildId,
            10
          );


          await interaction.editReply(
            "⏩ 10 seconds hore ayaa loo dhaqaaqay."
          );

        }


        /* LOOP */

        else if (
          interaction.customId ===
          "loop"
        ) {

          musicData.loop =
            !musicData.loop;


          await updateMusicMessage(
            musicData
          );


          await interaction.reply({

            content:
              musicData.loop
                ? "🔂 Loop waa shidan yahay."
                : "❌ Loop waa dansan yahay.",

            flags:
              MessageFlags.Ephemeral

          });

        }


        /* VOLUME */

        else if (
          interaction.customId ===
          "volume"
        ) {

          const modal =
            new ModalBuilder()

              .setCustomId(
                "volume_modal"
              )

              .setTitle(
                "Beddel Volume"
              );


          const input =
            new TextInputBuilder()

              .setCustomId(
                "volume_input"
              )

              .setLabel(
                "Geli Volume 1 - 100"
              )

              .setStyle(
                TextInputStyle.Short
              )

              .setPlaceholder(
                "50"
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


          await interaction.showModal(
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
          "volume_modal"
        ) {

          const musicData =
            players.get(
              interaction.guild.id
            );


          if (!musicData) {

            return interaction.reply({

              content:
                "❌ Wax hees ah ma socoto!",

              flags:
                MessageFlags.Ephemeral

            });

          }


          const value =
            Number(
              interaction.fields
                .getTextInputValue(
                  "volume_input"
                )
            );


          if (
            !Number.isFinite(value) ||
            value < 1 ||
            value > 100
          ) {

            return interaction.reply({

              content:
                "❌ Geli number 1 ilaa 100!",

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
              `🔊 Volume waxaa loo dhigay **${value}%**.`,

            flags:
              MessageFlags.Ephemeral

          });

        }

      }


    } catch (error) {

      console.error(
        "INTERACTION ERROR:",
        error
      );


      try {

        if (
          interaction.deferred ||
          interaction.replied
        ) {

          await interaction.editReply(
            "❌ Khalad ayaa dhacay."
          );

        } else {

          await interaction.reply({

            content:
              "❌ Khalad ayaa dhacay.",

            flags:
              MessageFlags.Ephemeral

          });

        }

      } catch {}

    }

  }
);


/* =========================
   LOGIN
========================= */

client.login(
  TOKEN
);
